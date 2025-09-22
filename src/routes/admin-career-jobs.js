import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';
import { invalidateJobCache } from './career.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('ADMIN'));

// Get all jobs with advanced filtering and pagination
router.get('/', [
  query('search').optional().isString().withMessage('Search must be a string'),
  query('type').optional().isString().withMessage('Job type must be a string'),
  query('department').optional().isString().withMessage('Department must be a string'),
  query('location').optional().isString().withMessage('Location must be a string'),
  query('status').optional().isIn(['active', 'archived', 'all']).withMessage('Status must be active, archived, or all'),
  query('sortBy').optional().isIn(['createdAt', 'title', 'applications', 'postedDate']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
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
    const { 
      search, 
      type, 
      department, 
      location, 
      status = 'active',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 5
    } = req.query;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = {};
    
    // Status filtering
    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'archived') {
      where.isActive = false;
    }
    // 'all' includes both active and archived

    // Search filtering
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { requirements: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Specific filters
    if (type) where.type = type;
    if (department) where.department = { contains: department, mode: 'insensitive' };
    if (location) where.location = { contains: location, mode: 'insensitive' };

    // Build orderBy with performance optimizations
    const orderBy = {};
    if (sortBy === 'applications') {
      // For applications count, we need to use a different approach
      orderBy.createdAt = 'desc'; // Default fallback
    } else {
      orderBy[sortBy] = sortOrder;
    }

    // Get jobs with pagination and total count
    const [jobs, total] = await Promise.all([
      prisma.jobs.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          requirements: true,
          location: true,
          type: true,
          department: true,
          salary: true,
          responsibilities: true,
          postedDate: true,
          skills: true,
          benefits: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              career_applications: true
            }
          }
        },
        skip,
        take: parseInt(limit),
        orderBy
      }),
      prisma.jobs.count({ where })
    ]);

    // Parse JSON strings back to arrays for skills and benefits
    const transformedJobs = jobs.map(job => ({
      ...job,
      skills: job.skills ? JSON.parse(job.skills) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : [],
      applicationsCount: job._count.career_applications
    }));

    const totalPages = Math.ceil(total / parseInt(limit));

    // Log performance metrics
    logger.info(`Admin jobs query: ${transformedJobs.length} jobs returned, page ${page}/${totalPages}, total: ${total}`);

    res.status(200).json({
      success: true,
      data: transformedJobs,
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
    logger.error('Jobs fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch jobs'
    });
  }
}));

// Create job
router.post('/', [
  body('title').trim().notEmpty().withMessage('Job title is required'),
  body('description').trim().notEmpty().withMessage('Job description is required'),
  body('requirements').optional().isString().withMessage('Requirements must be a string'),
  body('location').optional().isString().withMessage('Location must be a string'),
  body('type').isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE']).withMessage('Invalid job type'),
  // New optional fields
  body('department').optional().isString().withMessage('Department must be a string'),
  body('salary').optional().isString().withMessage('Salary must be a string'),
  body('responsibilities').optional().isString().withMessage('Responsibilities must be a string'),
  body('postedDate').optional().isDate().withMessage('postedDate must be a valid date'),
  body('skills').optional().isArray().withMessage('Skills must be an array of strings'),
  body('skills.*').optional().isString().withMessage('Each skill must be a string'),
  body('benefits').optional().isArray().withMessage('Benefits must be an array of strings'),
  body('benefits.*').optional().isString().withMessage('Each benefit must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { title, description, requirements, location, type, department, salary, responsibilities, postedDate, skills, benefits } = req.body;

  try {
    const job = await prisma.jobs.create({
      data: {
        title,
        description,
        requirements,
        location,
        type,
        department,
        salary,
        responsibilities,
        postedDate: postedDate ? new Date(postedDate) : undefined,
        updatedAt: new Date(),
        skills: JSON.stringify(skills ?? []),
        benefits: JSON.stringify(benefits ?? [])
      }
    });

    logger.info(`Job created: ${job.title} by admin: ${req.user.email}`);

    // Invalidate cache when new job is created
    invalidateJobCache();

    // Parse JSON strings back to arrays for response
    const transformedJob = {
      ...job,
      skills: job.skills ? JSON.parse(job.skills) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : []
    };

    res.status(201).json({
      success: true,
      data: transformedJob,
      message: 'Job created successfully'
    });
  } catch (error) {
    logger.error('Job creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create job'
    });
  }
}));

// Update job
router.put('/', [
  body('id').isString().withMessage('Job ID is required'),
  body('title').optional().trim().notEmpty().withMessage('Job title cannot be empty'),
  body('description').optional().trim().notEmpty().withMessage('Job description cannot be empty'),
  body('requirements').optional().isString().withMessage('Requirements must be a string'),
  body('location').optional().isString().withMessage('Location must be a string'),
  body('type').optional().isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE']).withMessage('Invalid job type'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  // New optional fields
  body('department').optional().isString().withMessage('Department must be a string'),
  body('salary').optional().isString().withMessage('Salary must be a string'),
  body('responsibilities').optional().isString().withMessage('Responsibilities must be a string'),
  body('postedDate').optional().isDate().withMessage('postedDate must be a valid date'),
  body('skills').optional().isArray().withMessage('Skills must be an array of strings'),
  body('skills.*').optional().isString().withMessage('Each skill must be a string'),
  body('benefits').optional().isArray().withMessage('Benefits must be an array of strings'),
  body('benefits.*').optional().isString().withMessage('Each benefit must be a string'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }

  const { id, title, description, requirements, location, type, isActive, department, salary, responsibilities, postedDate, skills, benefits } = req.body;

  try {
    const existingJob = await prisma.jobs.findUnique({
      where: { id }
    });

    if (!existingJob) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (requirements !== undefined) updateData.requirements = requirements;
    if (location !== undefined) updateData.location = location;
    if (type !== undefined) updateData.type = type;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (department !== undefined) updateData.department = department;
    if (salary !== undefined) updateData.salary = salary;
    if (responsibilities !== undefined) updateData.responsibilities = responsibilities;
    if (postedDate !== undefined) updateData.postedDate = postedDate ? new Date(postedDate) : null;
    if (skills !== undefined) updateData.skills = JSON.stringify(skills);
    if (benefits !== undefined) updateData.benefits = JSON.stringify(benefits);

    const job = await prisma.jobs.update({
      where: { id },
      data: { ...updateData, updatedAt: new Date() }
    });

    logger.info(`Job updated: ${job.title} by admin: ${req.user.email}`);

    // Invalidate cache when job is updated
    invalidateJobCache();

    // Parse JSON strings back to arrays for response
    const transformedJob = {
      ...job,
      skills: job.skills ? JSON.parse(job.skills) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : []
    };

    res.status(200).json({
      success: true,
      data: transformedJob,
      message: 'Job updated successfully'
    });
  } catch (error) {
    logger.error('Job update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update job'
    });
  }
}));

// Delete job (hard delete from database)
router.delete('/', [
  query('id').isString().withMessage('Job ID is required'),
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
    const job = await prisma.jobs.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            career_applications: true
          }
        }
      }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Check if job has applications
    if (job._count.career_applications > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete job with ${job._count.career_applications} application(s). Please handle applications first.`
      });
    }

    // Hard delete - completely remove from database
    await prisma.jobs.delete({
      where: { id }
    });

    logger.info(`Job deleted: ${job.title} by admin: ${req.user.email}`);

    // Invalidate cache when job is deleted
    invalidateJobCache();

    res.status(200).json({
      success: true,
      message: 'Job deleted successfully'
    });
  } catch (error) {
    logger.error('Job deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete job'
    });
  }
}));

// Get career analytics
router.get('/analytics', asyncHandler(async (req, res) => {
  try {
    const [
      totalJobs,
      activeJobs,
      archivedJobs,
      totalApplications,
      applicationsByStatus,
      jobsByDepartment,
      jobsByType,
      recentActivity
    ] = await Promise.all([
      // Total counts
      prisma.jobs.count(),
      prisma.jobs.count({ where: { isActive: true } }),
      prisma.jobs.count({ where: { isActive: false } }),
      prisma.career_applications.count(),
      
      // Applications by status
      prisma.career_applications.groupBy({
        by: ['status'],
        _count: { status: true }
      }),
      
      // Jobs by department
      prisma.jobs.groupBy({
        by: ['department'],
        where: { isActive: true },
        _count: { department: true }
      }),
      
      // Jobs by type
      prisma.jobs.groupBy({
        by: ['type'],
        where: { isActive: true },
        _count: { type: true }
      }),
      
      // Recent activity
      prisma.career_applications.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          jobs: {
            select: { title: true }
          }
        }
      })
    ]);

    // Calculate conversion rates
    const conversionRates = {
      total: totalApplications,
      pending: applicationsByStatus.find(s => s.status === 'PENDING')?._count.status || 0,
      reviewing: applicationsByStatus.find(s => s.status === 'REVIEWING')?._count.status || 0,
      approved: applicationsByStatus.find(s => s.status === 'APPROVED')?._count.status || 0,
      rejected: applicationsByStatus.find(s => s.status === 'REJECTED')?._count.status || 0,
      hired: applicationsByStatus.find(s => s.status === 'HIRED')?._count.status || 0
    };

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalJobs,
          activeJobs,
          archivedJobs,
          totalApplications
        },
        conversionRates,
        jobsByDepartment: jobsByDepartment.map(d => ({
          department: d.department || 'Unspecified',
          count: d._count.department
        })),
        jobsByType: jobsByType.map(t => ({
          type: t.type,
          count: t._count.type
        })),
        recentActivity
      }
    });
  } catch (error) {
    logger.error('Career analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch career analytics'
    });
  }
}));

export default router;
