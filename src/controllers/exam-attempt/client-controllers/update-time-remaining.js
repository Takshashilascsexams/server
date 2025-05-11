import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";

/**
 * Controller to update time remaining for an exam attempt
 * Used for periodic sync to keep track of time even if user refreshes
 */
const updateTimeRemaining = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;
  const { timeRemaining } = req.body;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  if (timeRemaining === undefined || timeRemaining === null) {
    return next(new AppError("Time remaining is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Find the exam attempt
  const attempt = await ExamAttempt.findById(attemptId);
  if (!attempt) {
    return next(new AppError("Exam attempt not found", 404));
  }

  // Verify that the attempt belongs to this user
  if (attempt.userId.toString() !== userId.toString()) {
    return next(new AppError("Unauthorized access to this attempt", 403));
  }

  // Check if the attempt is still in progress
  if (attempt.status !== "in-progress") {
    return next(
      new AppError(
        `This exam attempt is already ${attempt.status}. Cannot update time.`,
        400
      )
    );
  }

  // Update the time remaining
  attempt.timeRemaining = timeRemaining;

  // If time is 0 or negative, mark as timed-out
  if (timeRemaining <= 0) {
    attempt.status = "timed-out";
    attempt.endTime = new Date();

    // In case of timeout, we'll auto-submit the exam
    // This requires the submit-exam logic to be reused here
    // For simplicity, we'll just mark it as timed-out here
    // and let the frontend call submit-exam
  }

  // Save the updated attempt
  await attempt.save();

  res.status(200).json({
    status: "success",
    message: "Time remaining updated successfully",
    data: {
      timeRemaining: attempt.timeRemaining,
      status: attempt.status,
    },
  });
});

export default updateTimeRemaining;
