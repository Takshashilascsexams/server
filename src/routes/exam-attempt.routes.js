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

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Get exam rules before starting
router.get("/rules/:examId", getExamRules);

// Start a new exam attempt
router.post("/start/:examId", startExam);

// Get questions for an active attempt
router.get("/questions/:attemptId", getExamQuestions);

// Save answer for a question
router.post("/answer/:attemptId/:questionId", saveAnswer);

// Update time remaining
router.put("/time/:attemptId", updateTimeRemaining);

// Submit exam
router.post("/submit/:attemptId", submitExam);

// Get result of an attempt
router.get("/result/:attemptId", getAttemptResult);

// Get all attempts by user
router.get("/user-attempts", getUserAttempts);

// Get rankings for an exam (public, with additional details for authenticated users)
router.get("/rankings/:examId", getExamRankings);

// Admin routes - require admin role
router.use(verifyUserIsAdmin);

// Calculate rankings for an exam
router.post("/calculate-rankings/:examId", calculateRankings);

// Export rankings
router.get("/export-rankings/:examId", exportRankings);

export default router;
