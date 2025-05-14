// src/controllers/exam-attempt/client-controllers/get-current-time.js
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { attemptService } from "../../../services/redisService.js";

const getCurrentTime = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Get current time remaining from Redis
  const timeRemaining = await attemptService.getCurrentTimeRemaining(attemptId);

  if (timeRemaining === null) {
    return next(new AppError("Exam timer not found", 404));
  }

  // Determine status based on time
  const status = timeRemaining <= 0 ? "timed-out" : "in-progress";

  // If timed out, queue for processing
  if (timeRemaining <= 0) {
    await attemptService.queueTimedOutExam(attemptId);
  }

  res.status(200).json({
    status: "success",
    data: {
      timeRemaining,
      status,
      serverTime: Date.now(),
    },
  });
});

export default getCurrentTime;
