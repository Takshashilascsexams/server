import express from "express";
import bulkQuestionController from "../controllers/question/create-and-validate-bulk-questions-json.js";
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply admin role validation to all routes
router.use(verifyUserIsSignedIn, verifyUserIsAdmin);

// Route for uploading and creating bulk questions
router.post("/bulk", bulkQuestionController.uploadBulkQuestions);

// Route for validating bulk questions without creating them
router.post("/bulk-validate", bulkQuestionController.validateBulkQuestions);

export default router;
