import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { uploadSingle, uploadDocument, handleUploadError } from '../middleware/upload.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { uploadBufferToS3 } from '../utils/storage.js';

const router = express.Router();

// Protect all upload routes
router.use(protect);
router.use(authorize('ADMIN'));

// Upload single image
router.post('/image', uploadSingle, handleUploadError, asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }

    // Upload the in-memory buffer to S3-compatible storage
    const { buffer, originalname, mimetype, size } = req.file;
    const uploadResult = await uploadBufferToS3({
      buffer,
      originalName: originalname,
      mimetype,
      prefix: 'product-images'
    });

    logger.info(`Image uploaded to S3: ${uploadResult.key} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      data: {
        key: uploadResult.key,
        originalName: originalname,
        size,
        mimetype,
        url: uploadResult.url
      },
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    logger.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload image'
    });
  }
}));

// Upload document (PDF or image) - for resumes, etc.
router.post('/document', uploadDocument, handleUploadError, asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No document file provided'
      });
    }

    // Upload the in-memory buffer to S3-compatible storage
    const { buffer, originalname, mimetype, size } = req.file;
    const uploadResult = await uploadBufferToS3({
      buffer,
      originalName: originalname,
      mimetype,
      prefix: 'documents'
    });

    logger.info(`Document uploaded to S3: ${uploadResult.key} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      data: {
        key: uploadResult.key,
        originalName: originalname,
        size,
        mimetype,
        url: uploadResult.url  
      },
      message: 'Document uploaded successfully'
    });
  } catch (error) {
    logger.error('Document upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload document'
    });
  }
}));

export default router;
