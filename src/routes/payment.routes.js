// src/routes/payment.routes.js
import express from "express";
import createPayment from "../controllers/payment/create-payment.js";
import verifyPayment from "../controllers/payment/verify-payment.js";
import checkExamAccess from "../controllers/payment/check-access.js";
import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(verifyUserIsSignedIn);

// Payment endpoints
router.post("/create", createPayment);
router.post("/verify", verifyPayment);
router.get("/check-access/:examId", checkExamAccess);

export default router;
