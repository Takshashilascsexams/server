// middleware/authMiddleware.js
import User from "../models/user.models.js";
import { AppError, catchAsync } from "../utils/errorHandler.js";

// Middleware to validate admin role
export const validateAdminRole = catchAsync(async (req, res, next) => {
  // 1. Extract user from Clerk auth (Clerk middleware already verified the token)
  const { userId } = req.auth;

  if (!userId) {
    return next(
      new AppError("You are not logged in. Please log in to get access.", 401)
    );
  }

  // 2. Check if user has admin role in Clerk (from token)
  const clerkUser = req.auth;
  const isClerkAdmin = clerkUser.sessionClaims?.metadata?.role === "admin";

  if (!isClerkAdmin) {
    return next(
      new AppError("You do not have permission to perform this action", 403)
    );
  }

  // 3. Double-check with MongoDB database
  const user = await User.findOne({ clerkId: userId });

  if (!user) {
    return next(new AppError("User not found in database", 404));
  }

  if (user.role !== "admin") {
    return next(
      new AppError("You do not have permission to perform this action", 403)
    );
  }

  // Add user to request for later use
  req.user = user;
  next();
});
