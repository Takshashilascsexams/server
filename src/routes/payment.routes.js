import express from "express";
import createPayment from "../controllers/payment/create-payment.js";
import verifyPayment from "../controllers/payment/verify-payment.js";
import checkExamAccess from "../controllers/payment/check-access.js";
import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";
import { paymentLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(verifyUserIsSignedIn);

// Apply payment-specific rate limiter to all payment routes
router.use(paymentLimiter);

// Payment endpoints
router.post("/create", createPayment);
router.post("/verify", verifyPayment);
router.get("/check-access/:examId", checkExamAccess);

export default router;
