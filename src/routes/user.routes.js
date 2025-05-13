import express from "express";

// User controllers
import getAllUsers from "../controllers/user/admin-controllers/get-all-users.js";
import getUserById from "../controllers/user/admin-controllers/get-user-by-id.js";

// Auth Middleware
import {
  verifyUserIsSignedIn,
  verifyUserIsAdmin,
} from "../middleware/authMiddleware.js";

// Rate limiting
import { apiLimiter } from "../middleware/rateLimiterMiddleware.js";

const router = express.Router();

// All user management routes require admin authentication
router.use(verifyUserIsSignedIn, verifyUserIsAdmin, apiLimiter);

// User management routes
router.get("/", getAllUsers);
router.get("/:id", getUserById);

export default router;
