import express from "express";
import compressResponse from "../utils/compressResponse.js";
import createExam from "../controllers/exam/create-exam.js";
import updateExam from "../controllers/exam/update-exam.js";
import updateExamStatus from "../controllers/exam/update-exam-status.js";
import deleteExam from "../controllers/exam/delete-exam.js";
import getAllExams from "../controllers/exam/get-all-exams.js";
import getSingleExam from "../controllers/exam/get-single-exam.js";
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply admin role validation to all routes
router.use(verifyUserIsSignedIn, verifyUserIsAdmin);

// Exam CRUD operations
router.get("/", compressResponse, getAllExams);
router.post("/", createExam);
router.get("/:id", compressResponse, getSingleExam);
router.put("/:id", updateExam);
router.patch("/:id/status", updateExamStatus);
router.delete("/:id", deleteExam);

export default router;
