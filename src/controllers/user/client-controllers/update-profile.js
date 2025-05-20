import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { userService } from "../../../services/redisService.js";

/**
 * Update user profile
 * Updates the profile information for the authenticated user
 */
const updateProfile = catchAsync(async (req, res, next) => {
  // Get user ID from auth middleware
  const userId = req.user.id;

  if (!userId) {
    return next(new AppError("User not authenticated", 401));
  }

  // Get update data from request body
  const { fullName, phoneNumber, dateOfBirth } = req.body;

  // Validate input
  if (!fullName && !phoneNumber && !dateOfBirth) {
    return next(new AppError("No update data provided", 400));
  }

  // Prepare update object with only provided fields
  const updateData = {};
  if (fullName) updateData.fullName = fullName;
  if (phoneNumber) updateData.phoneNumber = phoneNumber;
  if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;

  // Update user in database
  const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true,
  });

  if (!updatedUser) {
    return next(new AppError("User not found", 404));
  }

  // Prepare response data
  const responseData = {
    imageUrl: updatedUser.imageUrl || null,
    fullName: updatedUser.fullName || "User",
    role: updatedUser.role || "Student",
    email: updatedUser.email || "Not provided",
    phoneNumber: updatedUser.phoneNumber || "Not provided",
    dateOfBirth: updatedUser.dateOfBirth || "Not provided",
    joined: updatedUser.createdAt || Date.now(),
  };

  // Clear and update cache
  try {
    const cacheKey = `profile:${userId}`;
    await userService.setCache(cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to update profile cache:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    message: "Profile updated successfully",
    data: responseData,
  });
});

export default updateProfile;
