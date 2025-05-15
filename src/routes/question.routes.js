import express from "express";

// Server controllers
import getAllQuestions from "../controllers/question/admin-controllers/get-all-questions.js";
import getQuestionById from "../controllers/question/admin-controllers/get-question-by-id.js";
import createQuestion from "../controllers/question/admin-controllers/create-question.js";
import updateQuestion from "../controllers/question/admin-controllers/update-question.js";
import deleteQuestion from "../controllers/question/admin-controllers/delete-question.js";
import getQuestionsByExam from "../controllers/question/admin-controllers/get-questions-by-exam.js";

// Existing upload controllers
import bulkQuestionController from "../controllers/question/admin-controllers/create-and-validate-bulk-questions-json.js";
import uploadSingleQuestion from "../controllers/question/admin-controllers/single-upload.js";

// Auth Middleware
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

// Rate limiting
import { apiLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// ADMIN ROUTES - Require authentication and admin privileges
router.use(verifyUserIsSignedIn, verifyUserIsAdmin, apiLimiter);

// Question CRUD operations
router.get("/", getAllQuestions);
// Get questions by exam ID - must come before /:questionId route to avoid path conflicts
router.get("/exam/:examId", getQuestionsByExam);
router.get("/:questionId", getQuestionById);
router.post("/", createQuestion);
router.put("/:questionId", updateQuestion);
router.delete("/:questionId", deleteQuestion);

// Existing bulk upload routes
router.post("/upload-bulk", bulkQuestionController.uploadBulkQuestions);
router.post("/validate-bulk", bulkQuestionController.validateBulkQuestions);

// Existing single upload route
router.post("/upload-single", uploadSingleQuestion);

export default router;
