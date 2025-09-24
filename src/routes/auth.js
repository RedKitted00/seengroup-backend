import express from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { generateToken, generateRefreshToken, comparePassword, protect, hashPassword } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import cache from '../utils/cache.js';
import { sendEmail } from '../utils/resendEmailService.js';

const router = express.Router();

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    error: 'Too many login attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// OTP helpers
const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const OTP_LENGTH = 6;
const formatSixDigits = (num) => num.toString().padStart(6, '0');
const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

// Rate limit OTP verification attempts
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper to resolve admin and guardian recipients from Settings (fallback to env)
async function getAdminRecipients() {
  try {
    const settings = await prisma.settings.findMany({
      where: { key: { in: ['admin_email', 'guardian_email'] } },
      select: { key: true, value: true }
    });
    const map = settings.reduce((acc, s) => { acc[s.key] = s.value; return acc; }, {});
    const adminEmail = map['admin_email'] || process.env.ADMIN_EMAIL || 'info@seengrp.com';
    const guardianEmail = map['guardian_email'] || process.env.GUARDIAN_EMAIL || '';
    return { adminEmail, guardianEmail };
  } catch (e) {
    const adminEmail = process.env.ADMIN_EMAIL || 'info@seengrp.com';
    const guardianEmail = process.env.GUARDIAN_EMAIL || '';
    return { adminEmail, guardianEmail };
  }
}

// @desc    Login user (step 1: password verify → require OTP)
// @route   POST /api/auth/login
// @access  Public
router.post('/login', loginLimiter, [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { email, password, rememberMe } = req.body;

  try {
    // Find user by email
    const user = await prisma.users.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Check password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Step-up auth with OTP: generate and email a 6-digit code to configured admin inbox
    const otpCode = formatSixDigits(Math.floor(100000 + Math.random() * 900000));
    const otpHash = hashOtp(otpCode);
    const otpId = crypto.randomUUID();

    // Store OTP info in cache (hash + user id + rememberMe) and a resend cooldown marker
    const cacheKey = `otp_login_${otpId}`;
    cache.set(cacheKey, { otpHash, userId: user.id, rememberMe: !!rememberMe, email: user.email }, OTP_TTL_SECONDS);
    const cooldownKey = `otp_cd_${otpId}`;
    cache.set(cooldownKey, true, 30); // 30s resend cooldown

    // Send OTP email to admin/owner inbox (out-of-band)
    const { adminEmail, guardianEmail } = await getAdminRecipients();
    const toEmail = adminEmail;
    const userAgent = req.get('User-Agent') || 'unknown';
    const ip = req.ip;
    const subject = 'Your Seen Group admin login code';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin:0 auto; padding:20px;">
        <h2 style="margin:0 0 8px;">Your 6-digit login code</h2>
        <p style="margin:0 0 12px; color:#374151;">Use this code to finish signing in to the admin panel.</p>
        <div style="font-size:32px; letter-spacing:6px; font-weight:700; background:#111827; color:#fff; padding:12px 16px; text-align:center; border-radius:10px;">${otpCode}</div>
        <p style="color:#6B7280; margin:16px 0 0;">Code expires in 5 minutes.</p>
        <p style="color:#6B7280; margin:8px 0 0; font-size:13px;">Request from IP: ${ip} — Device: ${userAgent}</p>
      </div>`;
    const text = `Your 6-digit admin login code: ${otpCode}\nIt expires in 5 minutes.\nRequest IP: ${ip}\nDevice: ${userAgent}`;

    try {
      await sendEmail(toEmail, subject, html, text, { cc: guardianEmail || undefined });
      logger.info('OTP sent', { toEmail, cc: guardianEmail || undefined, ip, userAgent });
    } catch (e) {
      logger.error('Failed to send OTP email:', e);
      // Do not leak whether email sent; still require OTP
    }

    // Respond with OTP required (do NOT set auth cookies yet)
    res.status(202).json({
      success: true,
      message: 'OTP required. A code has been sent to the admin email.',
      data: { otpId }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}));

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { email } = req.body;

  try {
    // Find user by email
    const user = await prisma.users.findUnique({
      where: { email }
    });

    // Always return success to prevent email enumeration
    if (!user) {
      logger.warn(`Password reset requested for non-existent email: ${email}`);
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      logger.warn(`Password reset requested for inactive user: ${email}`);
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store reset token in database
    await prisma.users.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetTokenExpiry
      }
    });

    // TODO: Send email with reset link
    // For now, just log the reset token
    logger.info(`Password reset token generated for ${email}: ${resetToken}`);

    res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}));

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user
    }
  });
}));

// @desc    Refresh token
// @route   POST /api/auth/refresh
// @access  Public
router.post('/refresh', [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { refreshToken } = req.body;

  try {
    // Verify refresh token
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Check if user exists and is active
    const user = await prisma.users.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const newToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    res.status(200).json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
}));

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', protect, asyncHandler(async (req, res) => {
  try {
    // Clear the HTTP-only cookie
    res.clearCookie('adminToken');
    res.clearCookie('refreshToken');

    logger.info(`User logged out: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to logout'
    });
  }
}));

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
router.put('/change-password', [
  protect,
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { currentPassword, newPassword } = req.body;

  try {
    // Get user with password
    const user = await prisma.users.findUnique({
      where: { id: req.user.id }
    });

    // Verify current password
    const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    await prisma.users.update({
      where: { id: req.user.id },
      data: { password: hashedNewPassword }
    });

    logger.info(`Password changed for user: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Password change error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}));

export default router;

// @desc    Resend login OTP (cooldown protected)
// @route   POST /api/auth/2fa/resend
// @access  Public (requires otpId from prior login step)
router.post('/2fa/resend', [
  body('otpId').isString().notEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
  }

  const { otpId } = req.body;
  const cacheKey = `otp_login_${otpId}`;
  const record = cache.get(cacheKey);
  if (!record) {
    return res.status(404).json({ success: false, error: 'Session expired. Please login again.' });
  }

  // Cooldown check
  const cooldownKey = `otp_cd_${otpId}`;
  const onCooldown = cache.get(cooldownKey);
  if (onCooldown) {
    return res.status(429).json({ success: false, error: 'Please wait before requesting a new code.' });
  }

  // Generate new code and reset TTL to remaining time window
  const newCode = formatSixDigits(Math.floor(100000 + Math.random() * 900000));
  const newHash = hashOtp(newCode);
  // Keep userId and rememberMe from record; refresh TTL to full window
  cache.set(cacheKey, { ...record, otpHash: newHash }, OTP_TTL_SECONDS);
  cache.set(cooldownKey, true, 30);

  const { adminEmail, guardianEmail } = await getAdminRecipients();
  const toEmail = adminEmail;
  const userAgent = req.get('User-Agent') || 'unknown';
  const ip = req.ip;
  const subject = 'Your new Seen Group admin login code';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin:0 auto; padding:20px;">
      <h2 style="margin:0 0 8px;">Your new 6-digit login code</h2>
      <div style="font-size:32px; letter-spacing:6px; font-weight:700; background:#111827; color:#fff; padding:12px 16px; text-align:center; border-radius:10px;">${newCode}</div>
      <p style=\"color:#6B7280; margin:16px 0 0;\">Code expires in 5 minutes.</p>
      <p style=\"color:#6B7280; margin:8px 0 0; font-size:13px;\">Request from IP: ${ip} — Device: ${userAgent}</p>
    </div>`;
  const text = `Your new 6-digit admin login code: ${newCode}\nIt expires in 5 minutes.\nRequest IP: ${ip}\nDevice: ${userAgent}`;

  try {
    await sendEmail(toEmail, subject, html, text, { cc: guardianEmail || undefined });
    logger.info('OTP re-sent', { toEmail, cc: guardianEmail || undefined, ip, userAgent });
  } catch (e) {
    logger.error('Failed to resend OTP email:', e);
  }

  return res.status(200).json({ success: true, message: 'New code sent.' });
}));

// @desc    Verify login OTP (step 2) and issue tokens
// @route   POST /api/auth/2fa/verify
// @access  Public (after successful password check via otpId)
router.post('/2fa/verify', otpVerifyLimiter, [
  body('otpId').isString().notEmpty(),
  body('code').isLength({ min: OTP_LENGTH, max: OTP_LENGTH }).isNumeric()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
  }

  const { otpId, code } = req.body;
  const cacheKey = `otp_login_${otpId}`;
  const record = cache.get(cacheKey);

  // Generic error to avoid leaking info
  const invalidMsg = 'Invalid or expired code';

  if (!record) {
    return res.status(401).json({ success: false, error: invalidMsg });
  }

  try {
    const providedHash = hashOtp(String(code));
    if (providedHash !== record.otpHash) {
      // track failed attempts per otpId
      const failKey = `otp_fail_${otpId}`;
      const fails = (cache.get(failKey) || 0) + 1;
      // keep fail counter TTL aligned with OTP TTL (re-set each time for simplicity)
      cache.set(failKey, fails, OTP_TTL_SECONDS);
      if (fails >= 5) {
        cache.delete(cacheKey);
        cache.delete(failKey);
        return res.status(423).json({ success: false, error: 'Too many incorrect attempts. Please login again.' });
      }
      return res.status(401).json({ success: false, error: invalidMsg });
    }

    // One-time use
    cache.delete(cacheKey);

    // Fetch user and ensure still active
    const user = await prisma.users.findUnique({ where: { id: record.userId } });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Issue tokens
    const tokenExpiry = record.rememberMe ? '30d' : '24h';
    const token = generateToken(user.id, tokenExpiry);
    const refreshToken = generateRefreshToken(user.id);

    // Update last login
    await prisma.users.update({ where: { id: user.id }, data: { updatedAt: new Date() } });

    const { password: _, ...userWithoutPassword } = user;

    // Return tokens in JSON; frontend layer will set cookies
    return res.status(200).json({
      success: true,
      message: 'OTP verified',
      data: {
        token,
        refreshToken,
        user: userWithoutPassword
      }
    });
  } catch (error) {
    logger.error('OTP verify error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}));
