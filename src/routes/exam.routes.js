import express from "express";

// Server controllers
import createExam from "../controllers/exam/server-controllers/create-exam.js";
import updateExam from "../controllers/exam/server-controllers/update-exam.js";
import updateExamStatus from "../controllers/exam/server-controllers/update-exam-status.js";
import deleteExam from "../controllers/exam/server-controllers/delete-exam.js";
import getAllExams from "../controllers/exam/server-controllers/get-all-exams.js";
import getSingleExam from "../controllers/exam/server-controllers/get-single-exam.js";

// Client controllers
import getLatestTestSeries from "../controllers/exam/client-controllers/get-latest-test-series.js";

// Auth Middleware
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/test-series", verifyUserIsSignedIn, getLatestTestSeries);

// Apply admin role validation to server routes
router.use(verifyUserIsSignedIn, verifyUserIsAdmin);

// Exam CRUD operations
router.get("/", getAllExams);
router.post("/", createExam);
router.get("/:id", getSingleExam);
router.put("/:id", updateExam);
router.patch("/:id/status", updateExamStatus);
router.delete("/:id", deleteExam);

export default router;
