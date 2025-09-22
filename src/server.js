import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import routes
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import productRoutes from './routes/products.js';
import categoryRoutes from './routes/categories.js';
import contactRoutes from './routes/contact.js';
import careerRoutes from './routes/career.js';
import publicRoutes from './routes/public.js';
import analyticsRoutes from './routes/analytics.js';

// Import admin-specific routes
import adminCategoriesRoutes from './routes/admin-categories.js';
import adminSubcategoriesRoutes from './routes/admin-subcategories.js';
import adminProductsRoutes from './routes/admin-products.js';
import adminCareerJobsRoutes from './routes/admin-career-jobs.js';
import adminSettingsRoutes from './routes/admin-settings.js';
import uploadRoutes from './routes/upload.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import { performanceMonitor, queryPerformanceMonitor, memoryMonitor } from './middleware/performance.js';

// Import database connection
import { connectDB } from './config/database.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Allow Cloudflare Turnstile script
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      // Allow Turnstile iframe/frame resources
      frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
      // API calls to Turnstile verification endpoint (server-side) and general https
      connectSrc: ["'self'", 'https://challenges.cloudflare.com', 'https:'],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'https://workflow-seengroup.vercel.app',
  'https://www.seengrp.com',
  'https://seengrp.com',
  process.env.CORS_ORIGIN
].filter(Boolean); // Remove undefined values 

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // In non-production, allow any localhost port for convenience
    if (!isProduction && /^https?:\/\/localhost:\d+$/i.test(origin)) {
      return callback(null, true);
    }

    const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
    return callback(new Error(msg), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting - strict in production, lenient in development
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '', 10) || (isProduction ? 1000 : 5000),
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: isProduction ? false : true,
  skipFailedRequests: false,
  keyGenerator: (req) => {
    // Use IP + user agent for better rate limiting
    return req.ip + '|' + (req.headers['user-agent'] || 'unknown');
  },
  handler: (req, res) => {
    if (!isProduction) {
    }
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(60 / 1000), // 1 minute in seconds
      limit: isProduction ? 1000 : 5000,
      windowMs: 60000
    });
  },
});

// Speed limiting - stricter in production
const speedLimiter = slowDown({
  windowMs: 60 * 1000, // 1 minute
  delayAfter: isProduction ? 200 : 10000,
  delayMs: () => (isProduction ? 250 : 0),
});

// Debug middleware to log rate limiting info (opt-in via RATE_LIMIT_DEBUG)
if (!isProduction && process.env.RATE_LIMIT_DEBUG === 'true') {
  app.use((req, res, next) => {
    const clientIP = req.ip;
    const userAgent = req.headers['user-agent'] || 'unknown';
    const rateLimitKey = clientIP + '|' + userAgent;
    
    if (req.path.includes('/api/')) {
    }
    
    next();
  });
}

// Apply rate limiting to all routes
app.use(limiter);
app.use(speedLimiter);

// Admin routes rate limiting
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 300 : 10000,
  message: {
    error: 'Too many admin requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: isProduction ? false : true,
  keyGenerator: (req) => {
    // Use IP + user agent for better rate limiting
    return req.ip + '|' + (req.headers['user-agent'] || 'unknown');
  },
  handler: (req, res) => {
    if (!isProduction) {
    }
    res.status(429).json({
      error: 'Too many admin requests, please try again later.',
      retryAfter: Math.ceil(60 / 1000), // 1 minute in seconds
      limit: isProduction ? 300 : 10000,
      windowMs: 60000
    });
  },
});

// Cookie parser middleware
app.use(cookieParser());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Performance monitoring middleware
app.use(performanceMonitor);
app.use(queryPerformanceMonitor);
app.use(memoryMonitor);

// Static files
app.use('/uploads', express.static(join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// Rate limit test endpoint
app.get('/api/test-rate-limit', (req, res) => {
  res.status(200).json({
    message: 'Rate limit test successful',
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    rateLimitKey: req.ip + '|' + (req.headers['user-agent'] || 'unknown')
  });
});

// API routes - More specific routes first
app.use('/api/auth', authRoutes);
app.use('/api/admin/categories', adminLimiter, adminCategoriesRoutes);
app.use('/api/admin/subcategories', adminLimiter, adminSubcategoriesRoutes);
app.use('/api/admin/products', adminLimiter, adminProductsRoutes);
app.use('/api/admin/career/jobs', adminLimiter, adminCareerJobsRoutes);
app.use('/api/admin/settings', adminLimiter, adminSettingsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/career', careerRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/analytics', analyticsRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();
    
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

startServer();
