import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import createRedisClient from "../utils/redisClient.js";

// Create Redis client for rate limiting with dedicated prefix
const rateLimitRedis = createRedisClient("ratelimit:");

/**
 * Create a rate limiter middleware with specified options
 * @param {Object} options - Configuration options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per windowMs
 * @param {string} options.keyPrefix - Prefix for Redis keys
 * @param {string} options.message - Error message
 * @param {number} options.statusCode - HTTP status code for rate limit exceeded
 * @returns {Function} Express middleware
 */
export const createRateLimiter = (options = {}) => {
  const {
    windowMs = 60 * 1000, // Default: 1 minute
    max = 100, // Default: 100 requests per minute
    keyPrefix = "general",
    message = "Too many requests, please try again later.",
    statusCode = 429,
  } = options;

  // Create the rate limiter
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers

    // Use Redis as store when in production, memory store in development
    store:
      process.env.NODE_ENV === "production"
        ? new RedisStore({
            sendCommand: (...args) => rateLimitRedis.call(...args),
            prefix: `${keyPrefix}:`,
          })
        : null,

    // Custom handler for rate limited requests
    handler: (req, res, next, options) => {
      res.status(statusCode).json({
        status: "error",
        message: message,
      });
    },

    // Define key generator based on IP and user ID if available
    keyGenerator: (req, res) => {
      const userId = req.user?.sub || req.user?._id || "";
      const ip =
        req.ip ||
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        "";
      return `${keyPrefix}:${userId}:${ip}`;
    },

    // Skip rate limiting for certain paths or methods
    skip: (req, res) => {
      // Skip rate limiting for health checks and OPTIONS requests
      return req.path === "/health" || req.method === "OPTIONS";
    },
  });

  // Create a wrapped middleware that adds logging when limit is reached
  return (req, res, next) => {
    // Get current limit count
    limiter(req, res, (err) => {
      if (err) {
        return next(err);
      }

      // If limit was just reached (remaining = 0), log it
      // The RateLimit-Remaining header is typically available on res.get('RateLimit-Remaining')
      // but the library may also store it in req
      const remaining =
        res.get("RateLimit-Remaining") || req.rateLimit?.remaining;
      if (remaining === "0" || remaining === 0) {
        console.warn(
          `Rate limit reached: ${req.ip} ${req.method} ${req.originalUrl}`
        );
        // Could log to security monitoring system here
      }

      next();
    });
  };
};

// Standard API rate limiter for general API endpoints
export const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute
  keyPrefix: "api",
});

// Stricter rate limiter for authentication endpoints
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 attempts per 15 minutes
  keyPrefix: "auth",
  message:
    "Too many authentication attempts, please try again after 15 minutes.",
  statusCode: 429,
});

// Stricter rate limiter for payment endpoints
export const paymentLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // 15 payment requests per 10 minutes
  keyPrefix: "payment",
  message: "Too many payment requests, please try again later.",
  statusCode: 429,
});

// Rate limiter for user operations like registration, profile updates
export const userLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 requests per hour
  keyPrefix: "user",
  message: "Too many user operations, please try again later.",
  statusCode: 429,
});

// Apply appropriate rate limiters to routes
export default {
  apiLimiter,
  authLimiter,
  paymentLimiter,
  userLimiter,
  createRateLimiter, // Export factory function for custom limiters
};
