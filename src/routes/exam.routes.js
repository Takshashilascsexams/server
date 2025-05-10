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

// Rate limiting - import the new exam browsing specific limiter
import {
  examBrowseLimiter,
  apiLimiter,
} from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// AUTHENTICATED CLIENT ROUTES - Still use the generous limiter but require auth
router.get(
  "/test-series",
  verifyUserIsSignedIn,
  examBrowseLimiter,
  getLatestTestSeries
);
router.get(
  "/categorized",
  verifyUserIsSignedIn,
  examBrowseLimiter,
  getCategorizedExams
);

// ADMIN ROUTES - Use standard API limiter since these are admin-only operations
router.use(verifyUserIsSignedIn, verifyUserIsAdmin, apiLimiter);

// Exam CRUD operations
router.get("/", getAllExams);
router.post("/", createExam);
router.get("/:id", getSingleExam);
router.put("/:id", updateExam);
router.patch("/:id/status", updateExamStatus);
router.delete("/:id", deleteExam);

export default router;
