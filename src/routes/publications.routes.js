import express from "express";

// client controllers
import getActivePublications from "../controllers/publication/client-controllers/get-active-publications.js";
import getUserExamAttempts from "../controllers/publication/client-controllers/get-user-exam-attempts.js";

// admin controllers
import getExamPublications from "../controllers/publication/admin-controllers/get-exam-publications.js";
import generateExamResults from "../controllers/publication/admin-controllers/generate-exam-results.js";
import togglePublicationStatus from "../controllers/publication/admin-controllers/toggle-publication-status.js";
import getPublicationById from "../controllers/publication/admin-controllers/get-publication-by-id.js";

import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

import {
  examBrowseLimiter,
  apiLimiter,
} from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Regular authenticated route - With public-friendly browsing limits
router.get("/active", examBrowseLimiter, getActivePublications);
router.get("/user/attempts", examBrowseLimiter, getUserExamAttempts);

// Admin routes - require admin role
router.use(verifyUserIsAdmin);

// Admin operations use standard API limiter
router.get("/exams/:examId", apiLimiter, getExamPublications);
router.post("/exams/:examId/generate-results", apiLimiter, generateExamResults);
router.get("/:publicationId", apiLimiter, getPublicationById);
router.put("/:publicationId/status", apiLimiter, togglePublicationStatus);

export default router;
