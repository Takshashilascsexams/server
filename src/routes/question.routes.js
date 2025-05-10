import express from "express";
import bulkQuestionController from "../controllers/question/create-and-validate-bulk-questions-json.js";
import uploadSingleQuestion from "../controllers/question/single-upload.js";
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";
import { apiLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Apply admin role validation to all routes
router.use(verifyUserIsSignedIn, verifyUserIsAdmin);

// Apply standard API limiter to admin question operations
router.use(apiLimiter);

// Route for uploading and creating bulk questions
router.post("/bulk", bulkQuestionController.uploadBulkQuestions);

// Route for validating bulk questions without creating them
router.post("/bulk-validate", bulkQuestionController.validateBulkQuestions);

// Route for uploading single question
router.post("/single-upload", uploadSingleQuestion);

export default router;
