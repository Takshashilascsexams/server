import express from "express";
import getBundleDetails from "../controllers/bundle-exams/get-bundle-details.js";
import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";
import { examBrowseLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Use the more generous exam browsing limiter for bundle operations
// This is similar to browsing the exam catalog
router.use(examBrowseLimiter);

// Bundle endpoints
router.get("/:bundleId", getBundleDetails);

export default router;
