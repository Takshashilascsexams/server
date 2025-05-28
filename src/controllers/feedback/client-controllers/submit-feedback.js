import Feedback from "../../../models/feedback.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { feedbackService } from "../../../services/redisService.js";

/**
 * Controller to submit general user feedback
 * - Ensures one feedback per user with option to update existing
 * - Validates rating and comment fields
 * - Clears feedback cache when data changes
 */
const submitFeedback = catchAsync(async (req, res, next) => {
  const { rating, comment } = req.body;

  // Input validation
  if (!rating || rating < 1 || rating > 5) {
    return next(new AppError("Rating must be between 1 and 5", 400));
  }

  if (!comment || comment.trim().length < 5) {
    return next(new AppError("Comment must be at least 5 characters", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Check if user has already submitted feedback
  const existingFeedback = await Feedback.findOne({ userId });

  if (existingFeedback) {
    // Update existing feedback
    existingFeedback.rating = rating;
    existingFeedback.comment = comment;

    await existingFeedback.save();

    // ✅ FIXED: Clear platform feedback cache after successful update
    try {
      await feedbackService.clearPlatformFeedbackCache();
      console.log("Platform feedback cache cleared after update");
    } catch (cacheError) {
      console.error("Failed to clear feedback cache:", cacheError);
      // Don't fail the request if cache clearing fails
    }

    return res.status(200).json({
      status: "success",
      message: "Feedback updated successfully",
      data: {
        feedback: existingFeedback,
      },
    });
  }

  // Create new feedback
  const feedback = await Feedback.create({
    userId,
    rating,
    comment,
  });

  // ✅ FIXED: Clear platform feedback cache after successful creation
  try {
    await feedbackService.clearPlatformFeedbackCache();
    console.log("Platform feedback cache cleared after creation");
  } catch (cacheError) {
    console.error("Failed to clear feedback cache:", cacheError);
    // Don't fail the request if cache clearing fails
  }

  res.status(201).json({
    status: "success",
    message: "Feedback submitted successfully",
    data: {
      feedback,
    },
  });
});

export default submitFeedback;
