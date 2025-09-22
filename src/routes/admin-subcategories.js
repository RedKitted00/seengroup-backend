import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('ADMIN'));

// Get subcategories for a specific category
router.get('/:categoryId', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().isString().withMessage('Search must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { categoryId } = req.params;
  const { page = 1, limit = 20, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    // Check if category exists
    const category = await prisma.categories.findUnique({
      where: { id: categoryId }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Build where clause
    const where = {
      categoryId,
      isActive: true
    };

    // Search filtering
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get subcategories with pagination
    const [subcategories, total] = await Promise.all([
      prisma.subcategories.findMany({
        where,
        include: {
          _count: {
            select: {
              products: true
            }
          }
        },
        skip,
        take: parseInt(limit),
        orderBy: { name: 'asc' }
      }),
      prisma.subcategories.count({ where })
    ]);

    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      data: subcategories,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages
      }
    });
  } catch (error) {
    logger.error('Subcategories fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subcategories'
    });
  }
}));

// Create subcategory
router.post('/', [
  body('name').trim().notEmpty().withMessage('Subcategory name is required'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('categoryId').isString().withMessage('Category ID is required'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { name, description, categoryId } = req.body;

  try {
    // Check if category exists
    const category = await prisma.categories.findUnique({
      where: { id: categoryId }
    });

    if (!category) {
      return res.status(400).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Generate slug from name
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if subcategory with same name already exists in this category
    const existingSubcategory = await prisma.subcategories.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        categoryId: categoryId
      }
    });

    if (existingSubcategory) {
      return res.status(400).json({
        success: false,
        error: 'Subcategory with this name already exists in this category'
      });
    }

    const subcategory = await prisma.subcategories.create({
      data: {
        name,
        description,
        slug,
        categoryId,
        updatedAt: new Date()
      }
    });

    logger.info(`Subcategory created: ${subcategory.name} in category: ${category.name} by admin: ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: subcategory,
      message: 'Subcategory created successfully'
    });
  } catch (error) {
    logger.error('Subcategory creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create subcategory'
    });
  }
}));

// Update subcategory
router.put('/', [
  body('id').isString().withMessage('Subcategory ID is required'),
  body('name').optional().trim().notEmpty().withMessage('Subcategory name cannot be empty'),
  body('description').optional().isString().withMessage('Description must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { id, name, description } = req.body;

  try {
    // Check if subcategory exists
    const existingSubcategory = await prisma.subcategories.findUnique({
      where: { id },
      include: {
        category: {
          select: { name: true }
        }
      }
    });

    if (!existingSubcategory) {
      return res.status(404).json({
        success: false,
        error: 'Subcategory not found'
      });
    }

    // Generate new slug if name is being updated
    let slug = existingSubcategory.slug;
    if (name && name !== existingSubcategory.name) {
      slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // Check if new name conflicts with existing subcategory in the same category
      const conflictingSubcategory = await prisma.subcategories.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          categoryId: existingSubcategory.categoryId,
          NOT: { id }
        }
      });

      if (conflictingSubcategory) {
        return res.status(400).json({
          success: false,
          error: 'Subcategory with this name already exists in this category'
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (name !== undefined) updateData.slug = slug;

    const subcategory = await prisma.subcategories.update({
      where: { id },
      data: { ...updateData, updatedAt: new Date() }
    });

    logger.info(`Subcategory updated: ${subcategory.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      data: subcategory,
      message: 'Subcategory updated successfully'
    });
  } catch (error) {
    logger.error('Subcategory update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update subcategory'
    });
  }
}));

// Delete subcategory
router.delete('/', [
  query('id').optional().isString().withMessage('Subcategory ID must be a string'),
  body('id').optional().isString().withMessage('Subcategory ID must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  // Get ID from either query or body
  const id = req.query.id || req.body.id;
  
  // Additional validation
  if (!id || typeof id !== 'string' || id.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'Invalid subcategory ID provided'
    });
  }

  try {
    const subcategory = await prisma.subcategories.findUnique({
      where: { id }
    });

    if (!subcategory) {
      return res.status(404).json({
        success: false,
        error: 'Subcategory not found'
      });
    }

    // Check if subcategory has ACTIVE products
    const activeProductsCount = await prisma.products.count({
      where: { subcategoryId: id, isActive: true }
    });

    if (activeProductsCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete subcategory with existing products'
      });
    }

    // Hard delete - completely remove from database
    await prisma.subcategories.delete({
      where: { id }
    });

    logger.info(`Subcategory deleted: ${subcategory.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Subcategory deleted successfully'
    });
  } catch (error) {
    logger.error('Subcategory deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete subcategory'
    });
  }
}));

export default router;
