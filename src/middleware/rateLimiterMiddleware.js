import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import createRedisClient from "../utils/redisClient.js";
import os from "os";

// Create dedicated Redis client for rate limiting
const rateLimitRedis = createRedisClient("ratelimit:");

// Add error handling to Redis client
rateLimitRedis.on("error", (err) => {
  console.error("Rate limiter Redis client error:", err);
  // Errors will be handled by the onError handler in RedisStore
  // The limiter will fall back to in-memory storage
});

// Add reconnection handler
rateLimitRedis.on("reconnecting", () => {
  console.log("Rate limiter Redis client reconnecting...");
});

rateLimitRedis.on("connect", () => {
  console.log("Rate limiter Redis client connected");
});

// Function to get dynamic limits based on server load
// Optimized for 150-250 concurrent users taking 30-90 minute exams
const getDynamicLimits = () => {
  // Get current system CPU load
  const cpuLoad = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const cpuUsage = cpuLoad / cpuCount;

  // Adjust limits based on current CPU load
  // Math.max(0.8, 1 - cpuUsage) ensures we never go below 80% of max capacity
  // Higher minimum threshold for critical exam operations
  const loadFactor = Math.max(0.8, 1 - cpuUsage * 0.7); // Less aggressive scaling

  // Higher base limits for exam operations, moderate for others
  return {
    // General API - still generous but scaled for 250 users (2-3 requests per second per user)
    apiMax: Math.floor(1800 * loadFactor), // 1800 requests per minute (30/second)

    // Authentication - slightly increased but still protected
    authMax: Math.floor(180 * loadFactor), // 180 auth requests per 15 min

    // Public exam browsing operations
    examBrowseMax: Math.floor(2500 * loadFactor), // 2500 browsing operations per minute

    // Exam attempt operations - prioritized for active exams
    examAttemptMax: Math.floor(800 * loadFactor), // 800 exam attempts per minute (3.2/user)

    // Answer saving - very high for exam takers (10-12 answers per minute per user)
    saveAnswerMax: Math.floor(3500 * loadFactor), // 3500 answer saves per minute (14/user)

    // Batch operations - highly prioritized for efficiency
    batchAnswerMax: Math.floor(1200 * loadFactor), // 1200 batch operations per minute

    // Profile operations - moderated
    profileMax: Math.floor(1500 * loadFactor), // 1500 profile operations per minute (6/user)
  };
};

/**
 * Create a rate limiter middleware with specified options and dynamic scaling
 * Optimized for public usage with 500 concurrent users
 */
export const createRateLimiter = (options = {}) => {
  const {
    windowMs = 60 * 1000, // Default: 1 minute
    max = null, // Will use dynamic limits if null
    keyPrefix = "general",
    message = "Too many requests, please try again later.",
    statusCode = 429,
  } = options;

  // Determine which limit to use based on request type
  const getLimitForRequest = (req) => {
    const dynamicLimits = getDynamicLimits();

    // Use path-based determination for more granular control
    const path = req.path || "";

    // Special case: If this is specifically an exam question fetch or answer submission
    // during an active exam, use a higher limit to avoid interrupting exams
    if (
      path.includes("/api/v1/exam-attempt/questions") ||
      path.includes("/api/v1/exam-attempt/answer")
    ) {
      return Math.max(dynamicLimits.saveAnswerMax, 3000); // Always allow at least 3000/min
    }

    switch (keyPrefix) {
      case "api":
        return dynamicLimits.apiMax;
      case "auth":
        return dynamicLimits.authMax;
      case "exam-browse":
        return dynamicLimits.examBrowseMax;
      case "exam-attempt":
        return dynamicLimits.examAttemptMax;
      case "save-answer":
        return dynamicLimits.saveAnswerMax;
      case "batch-answer":
        return dynamicLimits.batchAnswerMax;
      case "profile":
        return dynamicLimits.profileMax;
      default:
        // Higher default for public operations
        return max || 300;
    }
  };

  // Create the rate limiter with Redis store for distributed access
  const limiter = rateLimit({
    windowMs,
    max: getLimitForRequest,
    standardHeaders: "draft-6",
    legacyHeaders: false,

    // Use Redis as store for distributed rate limiting
    // With fallback to memory store if Redis is unavailable
    store: new RedisStore({
      sendCommand: (...args) => rateLimitRedis.call(...args),
      prefix: `${keyPrefix}:`,
      resetExpiryOnChange: true,
      expiry: windowMs / 1000,
      // Add reconnection and error handling
      onError: (error) => {
        console.error(`Redis rate limiter error (${keyPrefix}):`, error);
        // Continue serving requests - will use memory store as fallback
        return null;
      },
    }),

    // Improved handler with more informative message
    handler: (req, res, next, options) => {
      // Log rate limiting events
      console.warn(
        `Rate limit exceeded: ${req.ip} ${req.method} ${req.originalUrl} [${keyPrefix}]`
      );

      // More informative message with estimated wait time
      res.status(statusCode).json({
        status: "error",
        message: `${message} You can try again in ${Math.ceil(
          windowMs / 1000
        )} seconds.`,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },

    // Improved key generator with better IP handling
    keyGenerator: (req, res) => {
      // Try multiple identifiers to handle various authentication states
      const userId = req.user?.sub || req.user?._id || "";
      const ip =
        req.ip ||
        req.headers["x-forwarded-for"] ||
        req.headers["x-real-ip"] ||
        req.socket.remoteAddress ||
        "unknown";

      const cleanIp = ip ? ip.split(",")[0].trim() : "unknown";

      // For authenticated users: use user ID as primary identifier
      // This is more generous as it's per-user rather than per-connection
      if (userId) {
        return `${keyPrefix}:user:${userId}`;
      }

      // For public users: use IP address
      return `${keyPrefix}:ip:${cleanIp}`;
    },

    // More paths to skip rate limiting for public operations
    skip: (req, res) => {
      // Skip rate limiting for health checks, static resources, and OPTIONS requests
      return (
        req.path === "/health" ||
        req.path === "/readiness" ||
        req.path.match(/\.(js|css|jpg|png|ico|svg|woff|woff2)$/) ||
        req.method === "OPTIONS" ||
        // Skip for public catalog endpoints to make browsing completely unrestricted
        req.path === "/api/v1/exam/latest" ||
        req.path === "/api/v1/exam/featured"
      );
    },
  });

  // Create a wrapped middleware that scales dynamically
  return (req, res, next) => {
    // Less aggressive throttling - only under extreme load
    const cpuLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPercentage = (cpuLoad / cpuCount) * 100;

    // Critical exam operations should always be allowed
    const criticalExamOperation =
      req.path.includes("/api/v1/exam-attempt/submit/") ||
      req.path.includes("/api/v1/exam-attempt/time/") ||
      (keyPrefix === "save-answer" && req.method === "POST") ||
      (keyPrefix === "batch-answer" && req.method === "POST");

    // Only throttle at very high CPU load (97% instead of 95%)
    if (loadPercentage > 97) {
      // Always allow critical exam operations
      if (criticalExamOperation) {
        return next();
      }

      // Even under extreme load, only throttle 5% of exam-related requests
      if (
        (keyPrefix === "exam-attempt" ||
          keyPrefix === "save-answer" ||
          keyPrefix === "batch-answer") &&
        Math.random() > 0.05
      ) {
        return next();
      }

      // For non-exam operations, throttle 15% of requests under high load
      if (Math.random() > 0.85) {
        return res.status(503).json({
          status: "error",
          message:
            "Our servers are experiencing unusually high traffic. Please try again in a few moments.",
          retryAfter: 5,
        });
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
// Optimized for public use with 500 concurrent users

// General API - very generous
export const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: "api",
  message: "You've made too many requests.",
});

// Authentication - reasonable protection
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: "auth",
  message: "Too many login attempts.",
});

// Exam browsing - extremely generous
export const examBrowseLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: "exam-browse",
  message: "You're browsing our catalog too quickly.",
});

// Exam attempt operations - generous to avoid interrupting exams
export const examAttemptLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: "exam-attempt",
  message: "Too many exam operations.",
});

// Answer saving - extended window for better stability during long exams
export const saveAnswerLimiter = createRateLimiter({
  windowMs: 15 * 1000, // 15 seconds instead of 10
  keyPrefix: "save-answer",
  message: "You're submitting answers too quickly.",
});

// Batch operations - extended window for better stability during long exams
export const batchAnswerLimiter = createRateLimiter({
  windowMs: 45 * 1000, // 45 seconds instead of 30
  keyPrefix: "batch-answer",
  message: "Too many batch operations.",
});

// Profile operations - generous for viewing history, results
export const profileLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: "profile",
  message: "Too many profile requests.",
});

// Payment remains more strict for security
export const paymentLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 60, // Reasonable limit
  keyPrefix: "payment",
  message: "Too many payment requests.",
});

// Export all limiters
export default {
  apiLimiter,
  authLimiter,
  examBrowseLimiter,
  examAttemptLimiter,
  saveAnswerLimiter,
  batchAnswerLimiter,
  profileLimiter,
  paymentLimiter,
  createRateLimiter,
};
