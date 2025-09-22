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

// Get products with advanced filtering (no pagination)
router.get('/', [
  query('categoryId').optional().isString().withMessage('Category ID must be a string'),
  query('subcategoryId').optional().isString().withMessage('Subcategory ID must be a string'),
  query('search').optional().isString().withMessage('Search must be a string'),
  query('status').optional().isIn(['active', 'archived', 'all']).withMessage('Status must be active, archived, or all'),
  query('priceMin').optional().isFloat({ min: 0 }).withMessage('Minimum price must be a positive number'),
  query('priceMax').optional().isFloat({ min: 0 }).withMessage('Maximum price must be a positive number'),
  query('sortBy').optional().isIn(['name', 'price', 'createdAt', 'updatedAt']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
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
    categoryId, 
    subcategoryId,
    search, 
    status = 'active',
    priceMin,
    priceMax,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  try {

    // Build where clause
    const where = {};
    
    // Status filtering
    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'archived') {
      where.isActive = false;
    }
    // 'all' includes both active and archived

    // Category filtering
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Subcategory filtering
    if (subcategoryId) {
      where.subcategoryId = subcategoryId;
    }

    // Search filtering
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { oemNumber: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Price range filtering
    if (priceMin || priceMax) {
      where.price = {};
      if (priceMin) where.price.gte = parseFloat(priceMin);
      if (priceMax) where.price.lte = parseFloat(priceMax);
    }

    // Get all products without pagination
    const productsRaw = await prisma.products.findMany({
      where,
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        subcategories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      },
      orderBy: { [sortBy]: sortOrder }
    });

    const products = productsRaw.map(p => ({
      ...p,
      category: p.categories,
      subcategory: p.subcategories,
      categories: undefined,
      subcategories: undefined
    }));

    res.status(200).json({
      success: true,
      data: products
    });
  } catch (error) {
    logger.error('Products fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
}));

// Create product
router.post('/', [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('oemNumber').optional().isString().withMessage('OEM Number must be a string'),
  body('manufacturer').optional().isString().withMessage('Manufacturer must be a string'),
  body('price').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
  }).withMessage('Price must be a positive number'),
  body('categoryId').isString().withMessage('Category ID is required'),
  body('subcategoryId').optional().isString().withMessage('Subcategory ID must be a string'),
  body('imageUrl').optional().isString().withMessage('Image URL must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { name, description, oemNumber, manufacturer, price, categoryId, subcategoryId, imageUrl } = req.body;

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

    // Check if subcategory exists and belongs to the category
    if (subcategoryId) {
      const subcategory = await prisma.subcategories.findFirst({
        where: { 
          id: subcategoryId,
          categoryId: categoryId
        }
      });

      if (!subcategory) {
        return res.status(400).json({
          success: false,
          error: 'Subcategory not found or does not belong to the selected category'
        });
      }
    }

    const productRaw = await prisma.products.create({
      data: {
        name,
        description,
        oemNumber,
        manufacturer,
        price: price ? String(price) : null,
        categoryId,
        subcategoryId: subcategoryId || null,
        imageUrl,
        updatedAt: new Date()
      },
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        subcategories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });
    const product = { 
      ...productRaw, 
      category: productRaw.categories, 
      subcategory: productRaw.subcategories,
      categories: undefined,
      subcategories: undefined
    };

    logger.info(`Product created: ${product.name} by admin: ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });
  } catch (error) {
    logger.error('Product creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create product'
    });
  }
}));

// Update product
router.put('/', [
  body('id').isString().withMessage('Product ID is required'),
  body('name').optional().trim().notEmpty().withMessage('Product name cannot be empty'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('oemNumber').optional().isString().withMessage('OEM Number must be a string'),
  body('manufacturer').optional().isString().withMessage('Manufacturer must be a string'),
  body('price').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
  }).withMessage('Price must be a positive number'),
  body('categoryId').optional().isString().withMessage('Category ID must be a string'),
  body('subcategoryId').optional().isString().withMessage('Subcategory ID must be a string'),
  body('imageUrl').optional().isString().withMessage('Image URL must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { id, name, description, oemNumber, manufacturer, price, categoryId, subcategoryId, imageUrl } = req.body;

  try {
    // Check if product exists
    const existingProduct = await prisma.products.findUnique({
      where: { id }
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check if category exists if categoryId is provided
    if (categoryId) {
      const category = await prisma.categories.findUnique({
        where: { id: categoryId }
      });

      if (!category) {
        return res.status(400).json({
          success: false,
          error: 'Category not found'
        });
      }
    }

    // Check if subcategory exists and belongs to the category
    if (subcategoryId) {
      const finalCategoryId = categoryId || existingProduct.categoryId;
      const subcategory = await prisma.subcategories.findFirst({
        where: { 
          id: subcategoryId,
          categoryId: finalCategoryId
        }
      });

      if (!subcategory) {
        return res.status(400).json({
          success: false,
          error: 'Subcategory not found or does not belong to the selected category'
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (oemNumber !== undefined) updateData.oemNumber = oemNumber;
    if (manufacturer !== undefined) updateData.manufacturer = manufacturer;
    if (price !== undefined) updateData.price = price ? String(price) : null;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (subcategoryId !== undefined) updateData.subcategoryId = subcategoryId || null;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

    const productRaw = await prisma.products.update({
      where: { id },
      data: { ...updateData, updatedAt: new Date() },
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        subcategories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });
    const product = { 
      ...productRaw, 
      category: productRaw.categories, 
      subcategory: productRaw.subcategories,
      categories: undefined,
      subcategories: undefined
    };

    logger.info(`Product updated: ${product.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });
  } catch (error) {
    logger.error('Product update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product'
    });
  }
}));

// Archive product (soft delete)
router.delete('/', [
  query('id').isString().withMessage('Product ID is required'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { id } = req.query;

  try {
    const product = await prisma.products.findUnique({
      where: { id }
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Soft delete - archive the product instead of removing
    const archivedProduct = await prisma.products.update({
      where: { id },
      data: {
        isActive: false,
      }
    });

    logger.info(`Product archived: ${product.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Product archived successfully',
      data: archivedProduct
    });
  } catch (error) {
    logger.error('Product archival error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to archive product'
    });
  }
}));

// Get product analytics
router.get('/analytics', asyncHandler(async (req, res) => {
  try {
    const [
      totalProducts,
      activeProducts,
      archivedProducts,
      productsByCategory,
      priceRanges,
      recentActivity
    ] = await Promise.all([
      // Total counts
      prisma.products.count(),
      prisma.products.count({ where: { isActive: true } }),
      prisma.products.count({ where: { isActive: false } }),
      
      // Products by category
      prisma.products.groupBy({
        by: ['categoryId'],
        where: { isActive: true },
        _count: { categoryId: true }
      }),
      
      // Price range distribution
      prisma.products.groupBy({
        by: ['price'],
        where: { isActive: true },
        _count: { price: true }
      }),
      
      // Recent activity
      prisma.products.findMany({
        take: 10,
        orderBy: { updatedAt: 'desc' },
        include: {
          categories: {
            select: { name: true }
          }
        }
      })
    ]);

    // Get category names for products by category
    const categoryIds = productsByCategory.map(p => p.categoryId);
    const categories = await prisma.categories.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true }
    });

    const productsByCategoryWithNames = productsByCategory.map(p => ({
      categoryId: p.categoryId,
      count: p._count.categoryId,
      categoryName: categories.find(c => c.id === p.categoryId)?.name || 'Unknown'
    }));

    // Calculate price ranges
    const priceRangeStats = {
      under10: 0,
      under50: 0,
      under100: 0,
      under500: 0,
      over500: 0
    };

    priceRanges.forEach(p => {
      const price = parseFloat(String(p.price));
      if (price < 10) priceRangeStats.under10++;
      else if (price < 50) priceRangeStats.under50++;
      else if (price < 100) priceRangeStats.under100++;
      else if (price < 500) priceRangeStats.under500++;
      else priceRangeStats.over500++;
    });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalProducts,
          activeProducts,
          archivedProducts
        },
        productsByCategory: productsByCategoryWithNames,
        priceRanges: priceRangeStats,
        recentActivity: recentActivity.map(p => ({ ...p, category: p.categories, categories: undefined }))
      }
    });
  } catch (error) {
    logger.error('Product analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product analytics'
    });
  }
}));

export default router;
