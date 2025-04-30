import express from "express";

// Server controllers
import createExam from "../controllers/exam/server-controllers/create-exam.js";
import updateExam from "../controllers/exam/server-controllers/update-exam.js";
import updateExamStatus from "../controllers/exam/server-controllers/update-exam-status.js";
import deleteExam from "../controllers/exam/server-controllers/delete-exam.js";
import getAllExams from "../controllers/exam/server-controllers/get-all-exams.js";
import getSingleExam from "../controllers/exam/server-controllers/get-single-exam.js";

// Client controllers
import getCategorizedExams from "../controllers/exam/client-controllers/get-categorized-exams.js";
import getLatestTestSeries from "../controllers/exam/client-controllers/get-latest-test-series.js";

// Auth Middleware
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

// Rate limiting
import { createRateLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Create a specific rate limiter for client exam endpoints
const clientExamLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyPrefix: "client-exam",
  message: "Too many exam requests. Please wait before trying again.",
});

// Client routes with rate limiting
router.get(
  "/test-series",
  verifyUserIsSignedIn,
  clientExamLimiter,
  getLatestTestSeries
);
router.get(
  "/categorized",
  verifyUserIsSignedIn,
  clientExamLimiter,
  getCategorizedExams
);

// Create a specific rate limiter for admin exam operations
const adminExamLimiter = createRateLimiter({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 20, // 20 requests per 2 minutes
  keyPrefix: "admin-exam",
  message: "Too many admin exam operations. Please wait before trying again.",
});

// Apply admin role validation and rate limiting to server routes
router.use(verifyUserIsSignedIn, verifyUserIsAdmin, adminExamLimiter);

// Exam CRUD operations
router.get("/", getAllExams);
router.post("/", createExam);
router.get("/:id", getSingleExam);
router.put("/:id", updateExam);
router.patch("/:id/status", updateExamStatus);
router.delete("/:id", deleteExam);

export default router;
