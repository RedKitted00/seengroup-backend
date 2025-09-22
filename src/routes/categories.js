import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Public routes - Get all active categories
router.get('/', [
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

  const { page = 1, limit = 10, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    // Build where clause
    const where = {
      isActive: true,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ]
      })
    };

    // Get categories with pagination
    const [categories, total] = await Promise.all([
      prisma.categories.findMany({
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
        orderBy: { createdAt: 'desc' }
      }),
              prisma.categories.count({ where })
    ]);

    const totalPages = Math.ceil(total / parseInt(limit));

    res.status(200).json({
      success: true,
      data: categories,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    logger.error('Categories fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
}));

// Get single category by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const category = await prisma.categories.findUnique({
      where: { id },
      include: {
        products: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            imageUrl: true,
            createdAt: true
          }
        },
        _count: {
          select: {
            products: true
          }
        }
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Category fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category'
    });
  }
}));

// Protected routes - Admin only
router.use(protect);
router.use(authorize('ADMIN'));

// Create category
router.post('/', [
  body('name').trim().notEmpty().withMessage('Category name is required'),
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

  const { name, description } = req.body;

  try {
    // Generate slug from name
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if category with same name or slug already exists
    const existingCategory = await prisma.categories.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          { slug: { equals: slug, mode: 'insensitive' } }
        ]
      }
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        error: 'Category with this name already exists'
      });
    }

    const category = await prisma.categories.create({
      data: {
        name,
        description,
        slug,
        updatedAt: new Date()
      }
    });

    logger.info(`Category created: ${category.name} by admin: ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: category,
      message: 'Category created successfully'
    });
  } catch (error) {
    logger.error('Category creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create category'
    });
  }
}));

// Update category
router.put('/:id', [
  body('name').optional().trim().notEmpty().withMessage('Category name cannot be empty'),
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

  const { id } = req.params;
  const { name, description } = req.body;

  try {
    // Check if category exists
    const existingCategory = await prisma.categories.findUnique({
      where: { id }
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    const updateData = {};
    if (name !== undefined) {
      updateData.name = name;
      // Generate new slug if name changed
      updateData.slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }
    if (description !== undefined) updateData.description = description;

    // Check if new name/slug conflicts with existing category
    if (name && name !== existingCategory.name) {
      const conflictingCategory = await prisma.categories.findFirst({
        where: {
          OR: [
            { name: { equals: name, mode: 'insensitive' } },
            { slug: { equals: updateData.slug, mode: 'insensitive' } }
          ],
          NOT: { id }
        }
      });

      if (conflictingCategory) {
        return res.status(400).json({
          success: false,
          error: 'Category with this name already exists'
        });
      }
    }

    const category = await prisma.categories.update({
      where: { id },
      data: { ...updateData, updatedAt: new Date() }
    });

    logger.info(`Category updated: ${category.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      data: category,
      message: 'Category updated successfully'
    });
  } catch (error) {
    logger.error('Category update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update category'
    });
  }
}));

// Delete category (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const category = await prisma.categories.findUnique({
      where: { id }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Only block if there are ACTIVE products in this category
    const activeProductsCount = await prisma.products.count({
      where: { categoryId: id, isActive: true }
    });
    if (activeProductsCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete category with existing products'
      });
    }

    // Hard delete - completely remove from database
    await prisma.categories.delete({
      where: { id }
    });

    logger.info(`Category deleted: ${category.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    logger.error('Category deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete category'
    });
  }
}));

export default router;
