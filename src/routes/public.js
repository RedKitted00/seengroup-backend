import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Public API route - to be implemented'
  });
}));

export default router;
