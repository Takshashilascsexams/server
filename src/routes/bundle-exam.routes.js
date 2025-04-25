import express from "express";
import getBundleDetails from "../controllers/bundle-exams/get-bundle-details.js";
import { verifyUserIsSignedIn } from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyUserIsSignedIn);

// Bundle endpoints
router.get("/:bundleId", getBundleDetails);

export default router;
