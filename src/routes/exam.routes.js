import express from "express";
import { requireAuth } from "@clerk/express";
import { validateAdminRole } from "../middleware/authMiddleware.js";
import createExam from "../controllers/exam/create-exam.js";
import updateExam from "../controllers/exam/update-exam.js";
import updateExamStatus from "../controllers/exam/update-exam-status.js";
import deleteExam from "../controllers/exam/delete-exam.js";
import getAllExams from "../controllers/exam/get-all-exams.js";
import getSingleExam from "../controllers/exam/get-single-exam.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(requireAuth({ signInUrl: "/sign-in" }));

// Apply admin role validation to all routes
router.use(validateAdminRole);

// Exam CRUD operations
router.get("/", getAllExams);
router.post("/", createExam);
router.get("/:id", getSingleExam);
router.put("/:id", updateExam);
router.patch("/:id/status", updateExamStatus);
router.delete("/:id", deleteExam);

export default router;
