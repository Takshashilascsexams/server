import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { attemptService } from "../../../services/redisService.js";

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

  // First, check if the attempt exists and belongs to this user (use cache-optimized query)
  const attempt = await ExamAttempt.findOne({
    _id: attemptId,
    userId,
    status: "in-progress",
  })
    .select("_id startTime timeRemaining")
    .lean();

  if (!attempt) {
    return next(new AppError("Exam attempt not found or not in progress", 404));
  }

  // Calculate absolute end time based on current server time and remaining time
  // This is the key change - we're storing when the exam should end, not just how much time is left
  const endTime = new Date(Date.now() + timeRemaining * 1000);

  // Store in Redis with TTL matching the time remaining (plus a buffer)
  const ttl = timeRemaining + 300; // Add 5 minutes buffer for safety

  // Store both remaining time and absolute end time
  await attemptService.setAttemptTimer(
    attemptId,
    {
      timeRemaining,
      absoluteEndTime: endTime.getTime(),
      lastSyncTime: Date.now(),
    },
    ttl
  );

  // Check if it's time to sync with the database
  // Only update the database occasionally to reduce load (every 5 minutes or less than 5 minutes remaining)
  const shouldUpdateDb =
    timeRemaining <= 300 ||
    !attempt.lastDbSync ||
    Date.now() - attempt.lastDbSync > 5 * 60 * 1000;

  if (shouldUpdateDb) {
    // Add to background job queue for DB updating instead of updating directly
    await attemptService.queueTimerSync(attemptId, timeRemaining, userId);
  }

  // Determine status based on time
  let status = "in-progress";
  if (timeRemaining <= 0) {
    status = "timed-out";
    // Add to immediate processing queue for timed-out exams
    await attemptService.queueTimedOutExam(attemptId);
  }

  res.status(200).json({
    status: "success",
    message: "Time remaining updated successfully",
    data: {
      timeRemaining,
      status,
      serverTime: Date.now(), // Send server time for client sync correction
    },
  });
});

export default updateTimeRemaining;
