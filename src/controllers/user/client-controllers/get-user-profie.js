import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { userService } from "../../../services/redisService.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";

/**
 * Get user profile
 * Returns the profile information for the authenticated user
 */
const getProfile = catchAsync(async (req, res, next) => {
  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Try to get from cache first
  try {
    const cacheKey = `profile:${userId}`;
    const cachedData = await userService.getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getProfile:", error);
    // Continue to database query on cache error
  }

  // Get user details from database
  const user = await User.findById(userId);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Prepare response data
  const responseData = {
    imageUrl: user.imageUrl || null,
    fullName: user.fullName || "User",
    role: user.role || "Student",
    email: user.email || "Not provided",
    phoneNumber: user.phoneNumber || "Not provided",
    dateOfBirth: user.dateOfBirth || "Not provided",
    joined: user.createdAt || Date.now(),
  };

  // Cache the result for 5 minutes
  try {
    const cacheKey = `profile:${userId}`;
    await userService.setCache(cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache profile data:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getProfile;
