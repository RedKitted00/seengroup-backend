import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// @desc    Track a page view
// @route   POST /api/analytics/track
// @access  Public (rate-limited globally)
router.post('/track', asyncHandler(async (req, res) => {
  try {
    const { path, sessionId } = req.body || {};
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    if (!path || typeof path !== 'string') {
      return res.status(400).json({ success: false, error: 'path is required' });
    }

    await prisma.page_views.create({
      data: {
        path,
        ip,
        userAgent,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
      },
    });

    res.status(201).json({ success: true });
  } catch (error) {
    logger.error('Track page view error:', error);
    res.status(500).json({ success: false, error: 'Failed to track page view' });
  }
}));

export default router;


