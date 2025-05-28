import express from "express";

// Dashboard controllers
import getDashboardStats from "../controllers/dashboard/admin-controllers/get-dashboard-stats.js";
import getDashboardOverview from "../controllers/dashboard/admin-controllers/get-dashboard-overview.js";
import getSystemHealth from "../controllers/dashboard/admin-controllers/get-system-health.js";
import getPerformanceMetrics from "../controllers/dashboard/admin-controllers/get-performance-metrics.js";
import getRecentActivityList from "../controllers/dashboard/admin-controllers/get-recent-activity.js";
import getDashboardAnalytics from "../controllers/dashboard/admin-controllers/get-dashboard-analytics.js";

// Auth Middleware
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

// Rate limiting
import { apiLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// All dashboard routes require admin authentication
router.use(verifyUserIsSignedIn, verifyUserIsAdmin, apiLimiter);

// Dashboard data endpoints
router.get("/stats", getDashboardStats);
router.get("/overview", getDashboardOverview);
router.get("/health", getSystemHealth);
router.get("/performance", getPerformanceMetrics);
router.get("/activity", getRecentActivityList);
router.get("/analytics", getDashboardAnalytics);

export default router;
