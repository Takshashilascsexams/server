import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import createRedisClient from "../utils/redisClient.js";
import os from "os";

// Create dedicated Redis client for rate limiting
const rateLimitRedis = createRedisClient("ratelimit:");

// Function to get dynamic limits based on server load
const getDynamicLimits = () => {
  // Get current system CPU load
  const cpuLoad = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const cpuUsage = cpuLoad / cpuCount;

  // Adjust limits based on current CPU load
  // Lower limits when system is under heavy load
  const loadFactor = Math.max(0.5, 1 - cpuUsage);

  return {
    apiMax: Math.floor(1000 * loadFactor), // up to 1000 requests per minute
    authMax: Math.floor(100 * loadFactor), // up to 100 auth requests per 15 min
    examAttemptMax: Math.floor(200 * loadFactor), // up to 200 exam attempts per minute
    saveAnswerMax: Math.floor(1500 * loadFactor), // up to 1500 answer saves per minute
    batchAnswerMax: Math.floor(300 * loadFactor), // up to 300 batch operations per minute
  };
};

/**
 * Create a rate limiter middleware with specified options and dynamic scaling
 */
export const createRateLimiter = (options = {}) => {
  const {
    windowMs = 60 * 1000, // Default: 1 minute
    max = null, // Will use dynamic limits if null
    keyPrefix = "general",
    message = "Too many requests, please try again later.",
    statusCode = 429,
  } = options;

  // Determine which limit to use
  const getLimitForRequest = (req) => {
    const dynamicLimits = getDynamicLimits();

    switch (keyPrefix) {
      case "api":
        return dynamicLimits.apiMax;
      case "auth":
        return dynamicLimits.authMax;
      case "exam-attempt":
        return dynamicLimits.examAttemptMax;
      case "save-answer":
        return dynamicLimits.saveAnswerMax;
      case "batch-answer":
        return dynamicLimits.batchAnswerMax;
      default:
        return max || 100;
    }
  };

  // Create the rate limiter with Redis store for distributed access
  const limiter = rateLimit({
    windowMs,
    max: getLimitForRequest,
    standardHeaders: "draft-6", // Updated from draft_polli_ratelimit_headers to standardHeaders
    legacyHeaders: false,

    // Use Redis as store for distributed rate limiting
    store: new RedisStore({
      sendCommand: (...args) => rateLimitRedis.call(...args),
      prefix: `${keyPrefix}:`,
      // Make sure to handle Redis connection issues gracefully
      resetExpiryOnChange: true,
      // Expire keys for cleanup
      expiry: windowMs / 1000,
    }),

    // Custom handler for rate limited requests
    handler: (req, res, next, options) => {
      // Log rate limiting events
      console.warn(
        `Rate limit exceeded: ${req.ip} ${req.method} ${req.originalUrl}`
      );

      res.status(statusCode).json({
        status: "error",
        message: message,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },

    // Define key generator with failover if user ID not available
    keyGenerator: (req, res) => {
      // Try multiple identifiers to handle various authentication states
      const userId = req.user?.sub || req.user?._id || "";
      const ip =
        req.ip ||
        req.headers["x-forwarded-for"] ||
        req.headers["x-real-ip"] ||
        req.socket.remoteAddress ||
        "unknown";

      // If we have user ID, use a combination for better accuracy
      if (userId) {
        return `${keyPrefix}:${userId}:${ip.split(",")[0].trim()}`;
      }

      // Fallback to IP-only for unauthenticated requests
      return `${keyPrefix}:ip:${ip.split(",")[0].trim()}`;
    },

    // Skip rate limiting for certain paths
    skip: (req, res) => {
      // Skip rate limiting for health checks and OPTIONS requests
      return (
        req.path === "/health" ||
        req.path === "/readiness" ||
        req.method === "OPTIONS"
      );
    },
  });

  // Create a wrapped middleware that scales dynamically
  return (req, res, next) => {
    // Implement graceful degradation for extreme load
    const cpuLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPercentage = (cpuLoad / cpuCount) * 100;

    // If system is under extreme load, prioritize critical operations
    if (loadPercentage > 85) {
      // Always allow batch save operations as they're more efficient
      if (keyPrefix === "batch-answer") {
        return next();
      }

      // Allow exam submissions and time updates even under heavy load
      if (
        keyPrefix === "exam-attempt" &&
        (req.path.includes("/submit/") || req.path.includes("/time/"))
      ) {
        return next();
      }

      // Throttle non-essential requests
      if (keyPrefix !== "save-answer" && keyPrefix !== "exam-attempt") {
        if (Math.random() > 0.7) {
          // Randomly throttle 30% of non-essential requests
          return res.status(503).json({
            status: "error",
            message: "Server is under heavy load. Please try again shortly.",
            retryAfter: 5,
          });
        }
      }
    }

    // Apply normal rate limiting
    limiter(req, res, (err) => {
      if (err) {
        return next(err);
      }
      next();
    });
  };
};

// Enhanced rate limiters for different routes
export const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: "api",
  message: "Too many API requests. Please wait before trying again.",
});

// Authentication limiter - more strict to prevent brute force
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: "auth",
  message:
    "Too many authentication attempts. Please try again after 15 minutes.",
});

// Special limiter for exam attempts - higher limits
export const examAttemptLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: "exam-attempt",
  message: "Too many exam operations. Please wait a moment before continuing.",
});

// Special limiter just for saving answers - very high limits
export const saveAnswerLimiter = createRateLimiter({
  windowMs: 10 * 1000, // 10 seconds
  keyPrefix: "save-answer",
  message: "You're answering questions too quickly. Please wait a moment.",
});

// New limiter specifically for batch operations
export const batchAnswerLimiter = createRateLimiter({
  windowMs: 30 * 1000, // 30 seconds
  keyPrefix: "batch-answer",
  message: "Too many batch operations. Please try again shortly.",
});

// Payment limiter remains more strict for security
export const paymentLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30, // Lower fixed limit for payment operations
  keyPrefix: "payment",
  message: "Too many payment requests. Please try again later.",
});

export default {
  apiLimiter,
  authLimiter,
  examAttemptLimiter,
  saveAnswerLimiter,
  batchAnswerLimiter,
  paymentLimiter,
  createRateLimiter,
};
