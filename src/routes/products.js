import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Public routes - Get all active products (no pagination)
router.get('/', [
  query('search').optional().isString().withMessage('Search must be a string'),
  query('categoryId').optional().isString().withMessage('Category ID must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { search, categoryId } = req.query;

  try {
    // Build where clause
    const where = {
      isActive: true,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { oemNumber: { contains: search, mode: 'insensitive' } },
          { manufacturer: { contains: search, mode: 'insensitive' } }
        ]
      }),
      ...(categoryId && { categoryId })
    };

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
      orderBy: { createdAt: 'desc' }
    });

    // Transform products to match frontend expectations
    const products = productsRaw.map(product => ({
      ...product,
      category: product.categories,
      subcategory: product.subcategories,
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

// Get products with advanced filtering
router.get('/filter', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      category,
      subcategory,
      manufacturer,
      oemNumber,
      filter_auxiliary,
      filter_components,
      filter_products,
      filter_parts
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build where clause
    let whereClause = { isActive: true };
    let includeClause = {
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
    };

    // Search functionality
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { oemNumber: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Category filter - handle multiple category IDs from auxiliary filter
    if (filter_auxiliary) {
      const categoryIds = filter_auxiliary.split(',').filter(Boolean);
      // Filter out "Show All" and only apply category filter if there are actual category IDs
      const actualCategoryIds = categoryIds.filter(id => id !== 'Show All');
      if (actualCategoryIds.length > 0) {
        whereClause.categoryId = { in: actualCategoryIds };
      }
      // If only "Show All" is selected or no actual category IDs, don't apply category filter
    } else if (category) {
      whereClause.categoryId = category;
    }

    // Subcategory filter - support single subcategory via `subcategory` and multi via `filter_components`
    if (filter_components) {
      const subcategoryIds = filter_components.split(',').filter(Boolean);
      const actualSubIds = subcategoryIds.filter(id => id !== 'Show All');
      if (actualSubIds.length > 0) {
        whereClause.subcategoryId = { in: actualSubIds };
      }
    } else if (subcategory) {
      whereClause.subcategoryId = subcategory;
    }

    // Manufacturer filter
    if (manufacturer) {
      whereClause.manufacturer = { contains: manufacturer, mode: 'insensitive' };
    }

    // OEM Number filter
    if (oemNumber) {
      whereClause.oemNumber = { contains: oemNumber, mode: 'insensitive' };
    }

    // Get total count
    const total = await prisma.products.count({ where: whereClause });

    // Get products with pagination
    const products = await prisma.products.findMany({
      where: whereClause,
      ...includeClause,
      skip: offset,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' }
    });

    // Transform data to match frontend expectations
    const transformedProducts = products.map(product => ({
      id: product.id,
      name: product.name,
      oemNumber: product.oemNumber,
      manufacturer: product.manufacturer,
      description: product.description,
      category: product.categories?.name || product.category || '',
      subcategory: product.subcategories?.name || product.subcategory || '',
      image: product.imageUrl,
      price: product.price,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    }));

    const totalPages = Math.ceil(total / parseInt(limit));
    const hasNext = parseInt(page) < totalPages;
    const hasPrev = parseInt(page) > 1;

    res.json({
      success: true,
      data: transformedProducts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext,
        hasPrev
      }
    });
  } catch (error) {
    console.error('Error fetching filtered products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
});

// Get manufacturers (using category names as manufacturers for now)
router.get('/manufacturers', async (req, res) => {
  try {
    const categories = await prisma.categories.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: { name: 'asc' }
    });

    const manufacturerList = categories.map(cat => cat.name);

    res.json({
      success: true,
      data: manufacturerList
    });
  } catch (error) {
    logger.error('Error fetching manufacturers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch manufacturers'
    });
  }
});

// Get categories for filtering
router.get('/categories', async (req, res) => {
  try {
    const categories = await prisma.categories.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true
      },
      orderBy: { name: 'asc' }
    });

    // Get subcategories for each category
    const categoriesWithSubcategories = await Promise.all(
      categories.map(async (category) => {
        const subcategories = await prisma.subcategories.findMany({
          where: { 
            categoryId: category.id,
            isActive: true 
          },
          select: {
            id: true,
            name: true,
            slug: true
          },
          orderBy: { name: 'asc' }
        });

        return {
          id: category.id,
          name: category.name,
          slug: category.slug,
          subcategories
        };
      })
    );

    res.json({
      success: true,
      data: categoriesWithSubcategories
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
});

// Search autocomplete
router.get('/search/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const suggestions = await prisma.products.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } }
        ]
      },
      select: {
        name: true,
        description: true
      },
      take: 10,
      orderBy: { name: 'asc' }
    });

    // Extract unique suggestions
    const uniqueSuggestions = [...new Set(
      suggestions.flatMap(item => [
        item.name,
        item.description
      ].filter(Boolean))
    )].slice(0, 10);

    res.json({
      success: true,
      data: uniqueSuggestions
    });
  } catch (error) {
    console.error('Error fetching autocomplete suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch suggestions'
    });
  }
});

// Get single product by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const productRaw = await prisma.products.findUnique({
      where: { id },
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

    if (!productRaw) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Transform product to match frontend expectations
    const product = {
      ...productRaw,
      category: productRaw.categories,
      subcategory: productRaw.subcategories,
      categories: undefined,
      subcategories: undefined
    };

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Product fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product'
    });
  }
}));

// Protected routes - Admin only
router.use(protect);
router.use(authorize('ADMIN'));

// Create product
router.post('/', [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('categoryId').isString().withMessage('Category ID is required'),
  body('imageUrl').optional().isURL().withMessage('Image URL must be valid'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { name, description, price, categoryId, imageUrl } = req.body;

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

    const product = await prisma.products.create({
      data: {
        name,
        description,
        price: price ? parseFloat(price) : null,
        categoryId,
        imageUrl
      },
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

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
router.put('/:id', [
  body('name').optional().trim().notEmpty().withMessage('Product name cannot be empty'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('categoryId').optional().isString().withMessage('Category ID must be a string'),
  body('imageUrl').optional().isURL().withMessage('Image URL must be valid'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
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
  const { name, description, price, categoryId, imageUrl, isActive } = req.body;

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

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price ? parseFloat(price) : null;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (isActive !== undefined) updateData.isActive = isActive;

    const product = await prisma.products.update({
      where: { id },
      data: updateData,
      include: {
        categories: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

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

// Delete product (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

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

    // Hard delete - completely remove from database
          await prisma.products.delete({
      where: { id }
    });

    logger.info(`Product deleted: ${product.name} by admin: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    logger.error('Product deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product'
    });
  }
}));

export default router;
