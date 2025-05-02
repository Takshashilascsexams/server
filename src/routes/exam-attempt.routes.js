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

import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

import { createRateLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Custom rate limiters for specific high-volume operations
const examAttemptLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyPrefix: "exam-attempt",
  message: "Too many exam attempt requests. Please wait before trying again.",
});

const saveAnswerLimiter = createRateLimiter({
  windowMs: 10 * 1000, // 10 seconds
  max: 20, // 20 requests per 10 seconds
  keyPrefix: "save-answer",
  message: "Too many answer save requests. Please wait before trying again.",
});

const rulesLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute
  keyPrefix: "rules",
  message: "Too many exam rules requests. Please wait before trying again.",
});

const questionsLimiter = createRateLimiter({
  windowMs: 30 * 1000, // 30 seconds
  max: 15, // 15 requests per 30 seconds
  keyPrefix: "questions",
  message: "Too many question requests. Please wait before trying again.",
});

const submitLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  keyPrefix: "submit",
  message: "Too many submission attempts. Please wait before trying again.",
});

const timeLimiter = createRateLimiter({
  windowMs: 5 * 1000, // 5 seconds
  max: 10, // 10 requests per 5 seconds
  keyPrefix: "time-update",
  message: "Too many time update requests. Please wait before trying again.",
});

// Get exam rules before starting
router.get("/rules/:examId", rulesLimiter, getExamRules);

// Start a new exam attempt
router.post("/start/:examId", examAttemptLimiter, startExam);

// Get questions for an active attempt
router.get("/questions/:attemptId", questionsLimiter, getExamQuestions);

// Save answer for a question
router.post("/answer/:attemptId/:questionId", saveAnswerLimiter, saveAnswer);

// Update time remaining
router.put("/time/:attemptId", timeLimiter, updateTimeRemaining);

// Submit exam
router.post("/submit/:attemptId", submitLimiter, submitExam);

// Get result of an attempt
router.get("/result/:attemptId", examAttemptLimiter, getAttemptResult);

// Get all attempts by user
router.get("/user-attempts", examAttemptLimiter, getUserAttempts);

// Get rankings for an exam (public, with additional details for authenticated users)
router.get("/rankings/:examId", examAttemptLimiter, getExamRankings);

// Admin routes - require admin role
router.use(verifyUserIsAdmin);

// Admin-specific rate limiter (less restrictive for admins)
const adminLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  keyPrefix: "admin-exam",
  message: "Too many admin operations. Please wait before trying again.",
});

// Calculate rankings for an exam
router.post("/calculate-rankings/:examId", adminLimiter, calculateRankings);

// Export rankings
router.get("/export-rankings/:examId", adminLimiter, exportRankings);

export default router;
