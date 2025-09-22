import { logger } from '../utils/logger.js';

// Performance monitoring middleware
export const performanceMonitor = (req, res, next) => {
  const start = Date.now();
  
  // Capture response time
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl } = req;
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn(`🐌 Slow request: ${method} ${originalUrl} - ${duration}ms`);
    }
    
    // Log all requests in development
    if (process.env.NODE_ENV === 'production') {
      logger.info(`${method} ${originalUrl} - ${duration}ms`);
    }
  });
  
  next();
};

// Database query performance monitoring
export const queryPerformanceMonitor = (req, res, next) => {
  const originalSend = res.send;
  const start = Date.now();
  
  res.send = function(data) {
    const duration = Date.now() - start;
    
    // Log slow database operations
    if (duration > 500) {
      logger.warn(`🐌 Slow database operation: ${req.method} ${req.originalUrl} - ${duration}ms`);
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

// Memory usage monitoring
export const memoryMonitor = (req, res, next) => {
  const memUsage = process.memoryUsage();
  const memUsageMB = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
  };
  
  // Log high memory usage
  if (memUsageMB.heapUsed > 100) { // Alert if heap usage > 100MB
    logger.warn(`⚠️ High memory usage: ${memUsageMB.heapUsed}MB`);
  }
  
  // Add memory info to response headers in development
  if (process.env.NODE_ENV === 'production') {
    res.set('X-Memory-Usage', `${memUsageMB.heapUsed}MB`);
  }
  
  next();
};
