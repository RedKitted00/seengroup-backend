import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sendEmail } from '../utils/resendEmailService.js';
import prisma from '../config/database.js';
import { contactRateLimiter } from '../middleware/rateLimiters.js';
// Use global fetch (Node 18+)

const router = express.Router();

// Submit contact form with product requirements
router.post('/', contactRateLimiter, [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('company').trim().notEmpty().withMessage('Company name is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('contactReason').trim().notEmpty().withMessage('Contact reason is required'),
  body('message').optional().trim(),
  // Accept either a JSON string or an object/array for requirements and productContext
  body('requirements').optional(),
  body('productContext').optional(),
  body('captchaToken').optional().isString().withMessage('Invalid captcha token'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { 
    firstName, 
    lastName, 
    company, 
    country, 
    phone, 
    email, 
    contactReason,
    message,
    requirements, 
    productContext,
    captchaToken
  } = req.body;

  // Verify Cloudflare Turnstile if enabled
  const captchaEnabled = (process.env.CAPTCHA_ENABLED || 'true').toLowerCase() === 'true';
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (captchaEnabled && (process.env.SKIP_CAPTCHA || 'false').toLowerCase() !== 'true') {
    if (!captchaToken) {
      return res.status(400).json({ success: false, error: 'Captcha verification required' });
    }
    // In non-production, if secret missing, skip verification to avoid blocking dev
    if (!turnstileSecret) {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Turnstile secret missing in non-production; skipping captcha verification');
      } else {
        logger.warn('CAPTCHA_ENABLED is true but TURNSTILE_SECRET_KEY is not set');
        return res.status(500).json({ success: false, error: 'Captcha verification misconfigured' });
      }
    }
    try {
      if (turnstileSecret) {
        const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(turnstileSecret)}&response=${encodeURIComponent(captchaToken)}`
        });
        const verifyJson = await verifyResp.json();
        if (!verifyJson.success) {
          logger.warn('Turnstile verification failed', { errors: verifyJson["error-codes"], action: verifyJson.action, cdata: verifyJson.cdata });
          return res.status(400).json({ success: false, error: 'Captcha verification failed' });
        }
      }
    } catch (captchaErr) {
      logger.error('Turnstile verification error:', captchaErr);
      return res.status(502).json({ success: false, error: 'Captcha verification service unavailable' });
    }
  }
  
  try {
    // Parse requirements and product context
    let parsedRequirements = [];
    let parsedProductContext = null;

    // Only parse requirements if contact reason is sales
    if (contactReason === 'sales' && requirements) {
      try {
        if (typeof requirements === 'string') {
          parsedRequirements = JSON.parse(requirements);
        } else if (Array.isArray(requirements)) {
          parsedRequirements = requirements;
        } else if (typeof requirements === 'object') {
          // single object -> wrap as array
          parsedRequirements = [requirements];
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid requirements format'
        });
      }

      // Validate requirements structure for sales
      if (!Array.isArray(parsedRequirements) || parsedRequirements.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one product requirement is required for sales inquiries'
        });
      }

      // Validate each product requirement
      const allowedLeadTimes = new Set(['immediate', '1-2 weeks', '2-4 weeks', '1-2 months', '2+ months']);
      for (const item of parsedRequirements) {
        const productName = typeof item?.productName === 'string' ? item.productName.trim() : '';
        const quantityNum = Number.isInteger(item?.quantity) ? item.quantity : parseInt(item?.quantity, 10);
        const leadTime = typeof item?.leadTime === 'string' ? item.leadTime.trim() : '';
        const partNumber = typeof item?.partNumber === 'string' ? item.partNumber.trim() : '';

        if (!productName) {
          return res.status(400).json({ success: false, error: 'Each product requires a productName' });
        }
        if (!Number.isFinite(quantityNum) || quantityNum < 1) {
          return res.status(400).json({ success: false, error: 'Each product requires a valid quantity (>= 1)' });
        }
        if (!leadTime || !allowedLeadTimes.has(leadTime)) {
          return res.status(400).json({ success: false, error: 'Each product requires a valid lead time selection' });
        }
        if (productName.length > 200 || partNumber.length > 100) {
          return res.status(400).json({ success: false, error: 'Product fields exceed maximum length' });
        }
      }
    }

    // Validate message for non-sales contacts
    if (contactReason !== 'sales' && (!message || message.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide details about your inquiry'
      });
    }

    // Whitelist for contactReason
    const allowedReasons = new Set(['sales', 'complaint', 'follow-up', 'quality-warranty', 'financial']);
    if (!allowedReasons.has(String(contactReason))) {
      return res.status(400).json({ success: false, error: 'Invalid contact reason' });
    }

    if (productContext) {
      try {
        if (typeof productContext === 'string') {
          parsedProductContext = JSON.parse(productContext);
        } else if (typeof productContext === 'object') {
          parsedProductContext = productContext;
        }
      } catch (error) {
        logger.warn('Invalid product context format:', error);
      }
    }
    
    // Sanitize and constrain basic fields
    const safe = (val, max = 256) => (typeof val === 'string' ? val.trim().slice(0, max) : val);
    const safeFirstName = safe(firstName, 100);
    const safeLastName = safe(lastName, 100);
    const safeCompany = safe(company, 200);
    const safeCountry = safe(country, 64);
    const safePhone = safe(phone, 32);
    const safeEmail = safe(email, 254);
    const safeMessage = message ? safe(message, 2000) : null;
    const safeContactReason = safe(contactReason, 64);

    // Save the contact submission to database
    const newSubmission = await prisma.contact_submissions.create({
      data: {
        firstName: safeFirstName,
        lastName: safeLastName,
        company: safeCompany,
        country: safeCountry,
        phone: safePhone,
        email: safeEmail,
        contactReason: safeContactReason,
        message: safeMessage,
        // DB columns are String/Nullable → stringify complex payloads
        requirements: parsedRequirements.length > 0 ? JSON.stringify(parsedRequirements) : null,
        productContext: parsedProductContext ? JSON.stringify(parsedProductContext) : null,
        updatedAt: new Date()
      }
    });
     
    // Log the contact submission
    logger.info(`New contact form submission from: ${safeEmail}`, {
      contact: { firstName: safeFirstName, lastName: safeLastName, company: safeCompany, country: safeCountry, phone: safePhone, email: safeEmail },
      contactReason: safeContactReason,
      message: safeMessage || null,
      requirements: parsedRequirements,
      productContext: parsedProductContext,
      submissionId: newSubmission.id
    });

    // Attempt to send a confirmation email to the user (non-blocking)
    try {
      const companyName = process.env.COMPANY_NAME || 'Seen Group';
      const subject = `We received your request at ${companyName}`;
      const fullName = `${safeFirstName} ${safeLastName}`.trim();
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;line-height:1.6">
          <h2 style="margin:0 0 12px 0;">Thank you, ${fullName || 'there'}!</h2>
          <p>We’ve received your request and our team will get back to you within 24 hours.</p>
          <p style="margin:16px 0 4px;">Summary</p>
          <ul style="color:#555;">
            <li><strong>Reason:</strong> ${safeContactReason}</li>
            ${safeMessage ? `<li><strong>Message:</strong> ${safeMessage}</li>` : ''}
            ${Array.isArray(parsedRequirements) && parsedRequirements.length > 0 ? `<li><strong>Items:</strong> ${parsedRequirements.length}</li>` : ''}
          </ul>
          <p style="color:#666">If you have additional details to share, just reply to this email.</p>
          <p style="margin-top:24px;color:#888">— ${companyName} Support</p>
        </div>
      `;
      const text = `Thank you${fullName ? ', ' + fullName : ''}!
We’ve received your request and will get back to you within 24 hours.

Reason: ${safeContactReason}
${safeMessage ? `Message: ${safeMessage}\n` : ''}${Array.isArray(parsedRequirements) && parsedRequirements.length > 0 ? `Items: ${parsedRequirements.length}\n` : ''}
— ${companyName} Support`;

      const replyTo = process.env.REPLY_TO_EMAIL || process.env.CONTACT_EMAIL || process.env.ADMIN_EMAIL;
      sendEmail(safeEmail, subject, html, text, { replyTo })
        .then((r) => {
          if (!r.success) logger.warn('Contact confirmation email failed:', r.error);
        })
        .catch((err) => logger.warn('Contact confirmation email error:', err));
    } catch (mailErr) {
      logger.warn('Contact confirmation email skipped due to error:', mailErr);
    }

    // Notify admin (non-blocking) if configured
    try {
      if (process.env.ADMIN_EMAIL) {
        const adminSubject = `[CONTACT] New ${safeContactReason} from ${(safeFirstName + ' ' + safeLastName).trim() || safeEmail}`;
        const adminHtml = `
          <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;line-height:1.6">
            <h2 style="margin:0 0 8px 0;">New contact submission</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;width:140px;color:#374151;font-weight:600">Name</td><td style="padding:6px 0;color:#4b5563">${(safeFirstName + ' ' + safeLastName).trim()}</td></tr>
              <tr><td style="padding:6px 0;color:#374151;font-weight:600">Email</td><td style="padding:6px 0;color:#4b5563">${safeEmail}</td></tr>
              <tr><td style="padding:6px 0;color:#374151;font-weight:600">Company</td><td style="padding:6px 0;color:#4b5563">${safeCompany}</td></tr>
              <tr><td style="padding:6px 0;color:#374151;font-weight:600">Country</td><td style="padding:6px 0;color:#4b5563">${safeCountry}</td></tr>
              <tr><td style="padding:6px 0;color:#374151;font-weight:600">Phone</td><td style="padding:6px 0;color:#4b5563">${safePhone}</td></tr>
              <tr><td style="padding:6px 0;color:#374151;font-weight:600">Reason</td><td style="padding:6px 0;color:#4b5563">${safeContactReason}</td></tr>
            </table>
            ${safeMessage ? `<p style=\"margin-top:12px\"><strong>Message:</strong><br/>${safeMessage}</p>` : ''}
            ${Array.isArray(parsedRequirements) && parsedRequirements.length > 0 ? `<p style=\"margin-top:12px\"><strong>Items:</strong> ${parsedRequirements.length}</p>` : ''}
            <p style="margin-top:16px;color:#9ca3af;font-size:12px">Submission ID: ${newSubmission.id}</p>
          </div>
        `;
        const adminText = `New contact submission\nName: ${(safeFirstName + ' ' + safeLastName).trim()}\nEmail: ${safeEmail}\nCompany: ${safeCompany}\nCountry: ${safeCountry}\nPhone: ${safePhone}\nReason: ${safeContactReason}\n${safeMessage ? `Message: ${safeMessage}\n` : ''}${Array.isArray(parsedRequirements) && parsedRequirements.length > 0 ? `Items: ${parsedRequirements.length}\n` : ''}Submission ID: ${newSubmission.id}`;
        sendEmail(process.env.ADMIN_EMAIL, adminSubject, adminHtml, adminText, { replyTo: safeEmail })
          .catch((err) => logger.warn('Admin contact notification email error:', err));
      }
    } catch (adminMailErr) {
      logger.warn('Admin contact notification email skipped due to error:', adminMailErr);
    }

    res.status(201).json({
      success: true,
      message: 'Your request has been submitted successfully. We will contact you within 24 hours.',
      data: {
        id: newSubmission.id,
        submittedAt: newSubmission.createdAt
      }
    });

  } catch (error) {
    logger.error('Contact form submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit contact form. Please try again later.'
    });
  }
}));

// Get all contact submissions (admin only)
router.get('/submissions', protect, authorize('ADMIN'), asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, status, read, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = {
      ...(status && { status }),
      ...(read !== undefined && { read: read === 'true' }),
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
          { country: { contains: search, mode: 'insensitive' } }
        ]
      })
    };

    // Get submissions with pagination
    const [submissionsRaw, total] = await Promise.all([
      prisma.contact_submissions.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }),
      prisma.contact_submissions.count({ where })
    ]);

    // Parse JSON string fields so the frontend can iterate safely
    const submissions = submissionsRaw.map((s) => {
      let requirements = s.requirements;
      let productContext = s.productContext;
      try {
        if (typeof requirements === 'string') requirements = JSON.parse(requirements);
      } catch {}
      try {
        if (typeof productContext === 'string') productContext = JSON.parse(productContext);
      } catch {}
      return { ...s, requirements, productContext };
    });

    res.json({
      success: true,
      data: {
        submissions,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Contact submissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get contact submissions'
    });
  }
}));

// Get contact form statistics (admin only)
router.get('/stats', protect, authorize('ADMIN'), asyncHandler(async (req, res) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalSubmissions, recentSubmissions, countryStats, statusStats] = await Promise.all([
      prisma.contact_submissions.count(),
      prisma.contact_submissions.count({
        where: {
          createdAt: {
            gte: weekAgo
          }
        }
      }),
      // Get country statistics grouped by country
      prisma.contact_submissions.groupBy({
        by: ['country'],
        _count: {
          country: true
        },
        orderBy: {
          _count: {
            country: 'desc'
          }
        }
      }),
      prisma.contact_submissions.groupBy({
        by: ['status'],
        _count: {
          status: true
        },
        orderBy: {
          _count: {
            status: 'desc'
          }
        }
      })
    ]);

    // Convert country stats to object format
    const countryStatsObj = {};
    countryStats.forEach(stat => {
      countryStatsObj[stat.country] = stat._count.country;
    });

    // Convert status stats to object format
    const statusStatsObj = {};
    statusStats.forEach(stat => {
      statusStatsObj[stat.status] = stat._count.status;
    });

    res.json({
      success: true,
      data: {
        totalSubmissions,
        recentSubmissions,
        countryStats: countryStatsObj,
        statusStats: statusStatsObj
      }
    });

  } catch (error) {
    logger.error('Contact stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get contact statistics'
    });
  }
}));

// Get a single contact submission by ID
router.get('/submissions/:id', protect, authorize('ADMIN'), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    const submissionRaw = await prisma.contact_submissions.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!submissionRaw) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    // Normalize JSON fields for frontend usage
    let requirements = submissionRaw.requirements;
    let productContext = submissionRaw.productContext;
    try {
      if (typeof requirements === 'string') requirements = JSON.parse(requirements);
    } catch {}
    try {
      if (typeof productContext === 'string') productContext = JSON.parse(productContext);
    } catch {}
    const submission = { ...submissionRaw, requirements: requirements || [], productContext: productContext || null };

    res.json({
      success: true,
      data: submission
    });

  } catch (error) {
    logger.error('Contact submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get contact submission'
    });
  }
}));

// Update contact submission status
router.patch('/submissions/:id', protect, authorize('ADMIN'), [
  body('status').optional().isIn(['NEW', 'PROCESSING', 'CONTACTED', 'CLOSED']),
  body('read').optional().isBoolean(),
  body('notes').optional().isString()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  try {
    const { id } = req.params;
    const { status, read, notes } = req.body;

    const submission = await prisma.contact_submissions.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(read !== undefined && { read }),
        ...(notes && { notes }),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: submission
    });

  } catch (error) {
    logger.error('Contact submission update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contact submission'
    });
  }
}));

// Bulk delete contact submissions (MUST come before /submissions/:id route)
router.delete('/submissions/bulk', protect, authorize('ADMIN'), asyncHandler(async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Submission IDs array is required'
      });
    }

    // Validate that all IDs are valid UUIDs
    const validIds = ids.filter(id => typeof id === 'string' && id.trim() !== '');
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid submission IDs provided'
      });
    }


    // Delete multiple submissions
    const result = await prisma.contact_submissions.deleteMany({
      where: { id: { in: validIds } }
    });

    logger.info(`Bulk deleted ${result.count} contact submissions by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.count} submissions`,
      deletedCount: result.count
    });

  } catch (error) {
    console.error('Bulk deletion error details:', error);
    logger.error('Bulk deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete submissions',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}));

// Delete contact submission
router.delete('/submissions/:id', protect, authorize('ADMIN'), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    const submission = await prisma.contact_submissions.findUnique({
      where: { id }
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    await prisma.contact_submissions.delete({
      where: { id }
    });

    logger.info(`Contact submission deleted: ${id}`);

    res.status(200).json({
      success: true,
      message: 'Contact submission deleted successfully'
    });

  } catch (error) {
    logger.error('Contact submission deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete contact submission'
    });
  }
}));

export default router;
