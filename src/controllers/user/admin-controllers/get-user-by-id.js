import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { userService } from "../../../services/redisService.js";

/**
 * Get a single user by ID
 * Used for viewing user details
 */
const getUserById = catchAsync(async (req, res, next) => {
  const { id: userId } = req.params;

  if (!userId) {
    return next(new AppError("User ID is required", 400));
  }

  // Try to get from cache first
  try {
    const cachedData = await userService.getUserDetailsById(userId);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getUserById:", error);
    // Continue to database query on cache error
  }

  // Get user details from database
  const user = await User.findById(userId);

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Prepare response data
  const responseData = {
    user: user.toJSON(),
  };

  // Cache the result for 5 minutes
  try {
    await userService.setUserDetailsById(userId, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache user details:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getUserById;
