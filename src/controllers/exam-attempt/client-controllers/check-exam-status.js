import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { examService, attemptService } from "../../../services/redisService.js";

/**
 * Controller to check the status of an exam attempt
 * - Used by the frontend to verify if an attempt is still active
 * - Returns the current status of the attempt
 */

const checkExamStatus = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token with caching
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Try to get status from cache first for better performance
  try {
    const cachedStatus = await attemptService.getAttemptStatus(attemptId);

    if (cachedStatus) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: {
          attemptId,
          status: cachedStatus,
        },
      });
    }
  } catch (cacheError) {
    console.error("Cache error in checkExamStatus:", cacheError);
  }

  // Find the exam attempt with minimal projection for performance
  const attempt = await ExamAttempt.findOne({
    _id: attemptId,
    userId,
  })
    .select("status")
    .lean();

  if (!attempt) {
    return next(new AppError("Exam attempt not found", 404));
  }

  // Cache the status for future requests
  try {
    await attemptService.setAttemptStatus(attemptId, attempt.status, 60);
  } catch (cacheSetError) {
    console.error("Failed to cache exam status:", cacheSetError);
  }

  // Return the current status
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      attemptId,
      status: attempt.status,
    },
  });
});

export default checkExamStatus;
