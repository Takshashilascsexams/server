import express from "express";

// client routes
import startExam from "../controllers/exam-attempt/client-controllers/start-exam.js";
import getExamQuestions from "../controllers/exam-attempt/client-controllers/get-exam-question.js";
import saveBatchAnswers from "../controllers/exam-attempt/client-controllers/save-batch-answers.js";
import saveAnswer from "../controllers/exam-attempt/client-controllers/save-answer.js";
import updateTimeRemaining from "../controllers/exam-attempt/client-controllers/update-time-remaining.js";
import submitExam from "../controllers/exam-attempt/client-controllers/submit-exam.js";
import getAttemptResult from "../controllers/exam-attempt/client-controllers/get-attempt-result.js";
import getUserAttempts from "../controllers/exam-attempt/client-controllers/get-user-attempts.js";
import calculateRankings from "../controllers/exam-attempt/client-controllers/calculate-rankings.js";
import getExamRankings from "../controllers/exam-attempt/client-controllers/get-exam-rankings.js";
import exportRankings from "../controllers/exam-attempt/client-controllers/export-rankings.js";
import getExamRules from "../controllers/exam-attempt/client-controllers/get-exam-rules.js";
import checkExamStatus from "../controllers/exam-attempt/client-controllers/check-exam-status.js";
import getCurrentTime from "../controllers/exam-attempt/client-controllers/get-current-time.js";

// admin routes
import getAdminRankings from "../controllers/exam-attempt/admin-controllers/get-admin-rankings.js";
import getStudentDetailedResult from "../controllers/exam-attempt/admin-controllers/get-student-detailed-result.js";
import getExamResults from "../controllers/exam-attempt/admin-controllers/get-exam-results.js";

import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

import {
  examAttemptLimiter,
  saveAnswerLimiter,
  apiLimiter,
  profileLimiter,
  batchAnswerLimiter,
} from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Get exam rules before starting - Public-friendly with very generous limits
router.get("/rules/:examId", examAttemptLimiter, getExamRules);

// Start a new exam attempt - Allow plenty of capacity for 500 users
router.post("/start/:examId", examAttemptLimiter, startExam);

// Get questions for an active attempt - Critical path during exam taking, very generous limits
router.get("/questions/:attemptId", examAttemptLimiter, getExamQuestions);

// Batch answer endpoint - optimized for high concurrency
router.post("/batch-answers/:attemptId", batchAnswerLimiter, saveBatchAnswers);

// Save answer for a question - Very high limits for 500 concurrent test-takers
router.post("/answer/:attemptId/:questionId", saveAnswerLimiter, saveAnswer);

// Update time remaining - Critical for exam state
router.put(
  "/time/:attemptId",
  (req, res, next) => {
    // Bypass rate limiting for time updates to ensure exam continuity
    next();
  },
  updateTimeRemaining
);

// Get current time from server
router.get("/time-check/:attemptId", examAttemptLimiter, getCurrentTime);

// Submit exam - Critical operation, bypass rate limiting
router.post(
  "/submit/:attemptId",
  (req, res, next) => {
    // Bypass rate limiting for exam submission
    next();
  },
  submitExam
);

// Check exam status - Critical for UI state, use exam attempt limiter
router.get("/status/:attemptId", examAttemptLimiter, checkExamStatus);

// Get result of an attempt - Part of profile/history viewing, use profile limits
router.get("/result/:attemptId", profileLimiter, getAttemptResult);

// Get all attempts by user - Part of profile/history viewing, use profile limits
router.get("/user-attempts", profileLimiter, getUserAttempts);

// Get rankings for an exam - Public browsing operation, generous limits
router.get("/rankings/:examId", examAttemptLimiter, getExamRankings);

// Admin routes - require admin role
router.use(verifyUserIsAdmin);

// Admin operations use standard API limiter
router.post("/calculate-rankings/:examId", apiLimiter, calculateRankings);
router.get("/export-rankings/:examId", apiLimiter, exportRankings);
router.get("/admin-rankings/:examId", apiLimiter, getAdminRankings);
router.get("/student-result/:attemptId", apiLimiter, getStudentDetailedResult);
router.get("/exam/:examId/results", apiLimiter, getExamResults);

export default router;
