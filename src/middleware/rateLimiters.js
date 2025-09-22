import rateLimit from 'express-rate-limit';

// Contact form specific rate limiter
// Defaults can be overridden via env vars
const windowMs = parseInt(process.env.CONTACT_RATE_LIMIT_WINDOW_MS || '', 10) || (15 * 60 * 1000); // 15 minutes
const maxPerWindow = parseInt(process.env.CONTACT_RATE_LIMIT_MAX || '', 10) || 20; // 20 requests per window per IP/UA

export const contactRateLimiter = rateLimit({
  windowMs,
  max: maxPerWindow,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combine IP and User-Agent for a more granular key
    return `${req.ip}|${req.headers['user-agent'] || 'ua-unknown'}`;
  },
  message: {
    success: false,
    error: 'Too many contact requests. Please try again later.'
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many contact requests. Please try again later.',
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      limit: maxPerWindow
    });
  }
});


