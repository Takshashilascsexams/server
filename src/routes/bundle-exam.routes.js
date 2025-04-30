import express from "express";
import getBundleDetails from "../controllers/bundle-exams/get-bundle-details.js";
import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";
import { createRateLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Create a specific rate limiter for bundle operations
const bundleExamLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  keyPrefix: "bundle-exam",
  message: "Too many bundle exam requests. Please wait before trying again.",
});

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Apply rate limiting to all bundle routes
router.use(bundleExamLimiter);

// Bundle endpoints
router.get("/:bundleId", getBundleDetails);

export default router;
