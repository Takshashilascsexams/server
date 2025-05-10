import express from "express";
import startExam from "../controllers/exam-attempt/start-exam.js";
import getExamQuestions from "../controllers/exam-attempt/get-exam-question.js";
import saveAnswer from "../controllers/exam-attempt/save-answer.js";
import updateTimeRemaining from "../controllers/exam-attempt/update-time-remaining.js";
import submitExam from "../controllers/exam-attempt/submit-exam.js";
import getAttemptResult from "../controllers/exam-attempt/get-attempt-result.js";
import getUserAttempts from "../controllers/exam-attempt/get-user-attempts.js";
import calculateRankings from "../controllers/exam-attempt/calculate-rankings.js";
import getExamRankings from "../controllers/exam-attempt/get-exam-rankings.js";
import exportRankings from "../controllers/exam-attempt/export-rankings.js";
import getExamRules from "../controllers/exam-attempt/get-exam-rules.js";
import checkExamStatus from "../controllers/exam-attempt/check-exam-status.js";

import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

import {
  examAttemptLimiter,
  saveAnswerLimiter,
  apiLimiter,
  profileLimiter,
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

// Save answer for a question - Very high limits for 500 concurrent test-takers
router.post("/answer/:attemptId/:questionId", saveAnswerLimiter, saveAnswer);

// Update time remaining - Critical for exam state, very generous limits
router.put("/time/:attemptId", examAttemptLimiter, updateTimeRemaining);

// Submit exam - Critical operation, must not be rate-limited aggressively
router.post("/submit/:attemptId", examAttemptLimiter, submitExam);

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

export default router;
