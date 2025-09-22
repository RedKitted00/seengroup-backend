import { logger } from './logger.js';

class Cache {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map(); // Time to live for each cache entry
  }

  set(key, value, ttlSeconds = 300) { // Default 5 minutes TTL
    const expiry = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, value);
    this.ttl.set(key, expiry);
    
    logger.debug(`Cache set: ${key}, TTL: ${ttlSeconds}s`);
  }

  get(key) {
    const expiry = this.ttl.get(key);
    
    if (!expiry || Date.now() > expiry) {
      // Cache expired or doesn't exist
      this.delete(key);
      return null;
    }
    
    logger.debug(`Cache hit: ${key}`);
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    this.ttl.delete(key);
    logger.debug(`Cache deleted: ${key}`);
  }

  clear() {
    this.cache.clear();
    this.ttl.clear();
    logger.info('Cache cleared');
  }

  // Get cache statistics
  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, expiry] of this.ttl) {
      if (now > expiry) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }
    
    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      memoryUsage: process.memoryUsage()
    };
  }

  // Clean up expired entries
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, expiry] of this.ttl) {
      if (now > expiry) {
        this.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
    }
  }
}

// Create singleton instance
const cache = new Cache();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  cache.cleanup();
}, 5 * 60 * 1000);

export default cache;
