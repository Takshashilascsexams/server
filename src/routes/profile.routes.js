import express from "express";

// Profile controllers
import getProfile from "../controllers/user/client-controllers/get-user-profie.js";
import updateProfile from "../controllers/user/client-controllers/update-profile.js";

// Auth Middleware
import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";

// Rate limiting
import { apiLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// All profile routes require authentication
router.use(verifyUserIsSignedIn, apiLimiter);

// Profile routes
router.get("/", getProfile);
router.patch("/", updateProfile);

export default router;
