import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('ADMIN'));

// Get settings
router.get('/', asyncHandler(async (req, res) => {
  try {
    const settings = await prisma.settings.findMany({
      orderBy: { key: 'asc' }
    });

    // Convert array to object for easier frontend consumption
    const settingsObject = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: settingsObject
    });
  } catch (error) {
    logger.error('Settings fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings'
    });
  }
}));

// Update settings
router.put('/', [
  body().isObject().withMessage('Settings must be an object'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const settings = req.body;

  try {
    const updates = [];
    
    for (const [key, value] of Object.entries(settings)) {
      const update = prisma.settings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
      updates.push(update);
    }

    await prisma.$transaction(updates);

    logger.info(`Settings updated by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: settings
    });
  } catch (error) {
    logger.error('Settings update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
}));

// Get specific setting
router.get('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;

  try {
    const setting = await prisma.settings.findUnique({
      where: { key }
    });

    if (!setting) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }

    res.status(200).json({
      success: true,
      data: setting
    });
  } catch (error) {
    logger.error('Setting fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch setting'
    });
  }
}));

// Update specific setting
router.put('/:key', [
  body('value').notEmpty().withMessage('Value is required'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { key } = req.params;
  const { value } = req.body;

  try {
    const setting = await prisma.settings.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) }
    });

    logger.info(`Setting updated: ${key} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      data: setting,
      message: 'Setting updated successfully'
    });
  } catch (error) {
    logger.error('Setting update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update setting'
    });
  }
}));

export default router;
