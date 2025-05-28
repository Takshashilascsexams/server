import express from "express";
import submitFeedback from "../controllers/feedback/client-controllers/submit-feedback.js";
import getTopFeedbacks from "../controllers/feedback/client-controllers/get-top-feedbacks.js";

import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";
import { apiLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// Public route for getting top feedbacks - no auth required
router.get("/top", apiLimiter, getTopFeedbacks);

// Protected routes - require authentication
router.use(verifyUserIsSignedIn);

// Submit feedback
router.post("/", apiLimiter, submitFeedback);

export default router;
