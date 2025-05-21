import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { attemptService } from "../../../services/redisService.js";

/**
 * Enhanced time remaining controller that prioritizes exam continuity
 * and handles various authentication/authorization scenarios gracefully
 */
const updateTimeRemaining = catchAsync(async (req, res, next) => {
  // If headers already sent, exit early to avoid errors
  if (res.headersSent) {
    console.warn("Headers already sent before controller execution");
    return;
  }

  const { attemptId } = req.params;
  const { timeRemaining } = req.body;

  // Basic validation
  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  if (timeRemaining === undefined || timeRemaining === null) {
    return next(new AppError("Time remaining is required", 400));
  }

  try {
    // Handle various authentication scenarios
    let userId;

    // Normal flow - user is properly authenticated
    if (req.user && req.user.sub) {
      userId = await getUserId(req.user.sub);
    }
    // Auth warning flow - using partial token data
    else if (req.tokenWarning) {
      console.log("Using partial token data for timer update");
      userId = await getUserId(req.user.sub);
    }
    // Auth bypass flow - critical exam operation
    else if (req.authBypass) {
      console.log("Auth bypass for timer update, getting userId from attempt");
      // Get userId directly from the attempt
      const attemptData = await ExamAttempt.findById(attemptId)
        .select("userId")
        .lean();
      userId = attemptData?.userId;
    }

    // If we still can't determine userId, handle gracefully
    if (!userId) {
      console.warn(`Cannot determine userId for attempt ${attemptId}`);

      // Still allow the exam to continue client-side
      return res.status(200).json({
        status: "warning",
        message: "Timer updated but user identification issue detected",
        data: {
          timeRemaining,
          status: "in-progress",
          serverTime: Date.now(),
          authIssue: true,
        },
      });
    }

    // Use a more permissive check for the attempt
    const attemptCheck = req.authBypass
      ? { _id: attemptId } // Minimal check if auth is bypassed
      : { _id: attemptId, userId, status: "in-progress" }; // Normal check

    const attempt = await ExamAttempt.findOne(attemptCheck)
      .select("_id startTime timeRemaining")
      .lean();

    if (!attempt) {
      // Special handling - don't break the exam
      console.warn(`Attempt ${attemptId} not found with expected criteria`);
      return res.status(200).json({
        status: "warning",
        message: "Timer sync warning: attempt verification issue",
        data: {
          timeRemaining,
          status: "in-progress",
          serverTime: Date.now(),
          attemptWarning: true,
        },
      });
    }

    // Calculate absolute end time
    const endTime = new Date(Date.now() + timeRemaining * 1000);

    // Store in Redis with TTL matching the time remaining (plus a buffer)
    const ttl = timeRemaining + 300; // Add 5 minutes buffer for safety

    // Multiple retry attempt for Redis operations
    let redisSuccess = false;
    let retryCount = 0;
    let redisError = null;

    while (!redisSuccess && retryCount < 3) {
      try {
        await attemptService.setAttemptTimer(
          attemptId,
          {
            timeRemaining,
            absoluteEndTime: endTime.getTime(),
            lastSyncTime: Date.now(),
            userId: userId.toString(), // Include userId for data consistency
          },
          ttl
        );
        redisSuccess = true;
      } catch (error) {
        redisError = error;
        retryCount++;
        console.warn(
          `Redis attempt ${retryCount}/3 failed for timer sync: ${error.message}`
        );

        // Brief delay before retry
        if (retryCount < 3) {
          await new Promise((r) => setTimeout(r, 50 * retryCount));
        }
      }
    }

    // Queue updates if needed, but don't block the response
    try {
      const shouldUpdateDb =
        timeRemaining <= 300 ||
        !attempt.lastDbSync ||
        Date.now() - attempt.lastDbSync > 5 * 60 * 1000;

      if (shouldUpdateDb) {
        attemptService
          .queueTimerSync(attemptId, timeRemaining, userId)
          .catch((error) =>
            console.error(`Background timer sync error: ${error.message}`)
          );
      }

      // Handle timed-out exams
      if (timeRemaining <= 0) {
        attemptService
          .queueTimedOutExam(attemptId)
          .catch((error) =>
            console.error(`Error queueing timed-out exam: ${error.message}`)
          );
      }
    } catch (queueError) {
      // Log but don't fail the response
      console.error(`Queue operation error: ${queueError.message}`);
    }

    // Final check before sending response
    if (res.headersSent) {
      console.warn(
        `Headers already sent before response in updateTimeRemaining for ${attemptId}`
      );
      return;
    }

    // Send success response
    res.status(200).json({
      status: redisSuccess ? "success" : "warning",
      message: redisSuccess
        ? "Time remaining updated successfully"
        : "Time sync partial success (persistence issue)",
      data: {
        timeRemaining,
        status: timeRemaining <= 0 ? "timed-out" : "in-progress",
        serverTime: Date.now(),
        redisWarning: !redisSuccess,
        authWarning: !!(req.tokenWarning || req.authBypass),
      },
    });
  } catch (error) {
    // Ensure we don't try to send another response if one was already sent
    if (!res.headersSent) {
      console.error(`Timer update error for ${attemptId}:`, error);

      // Still return a somewhat successful response so the exam continues
      return res.status(200).json({
        status: "warning",
        message: "Timer sync encountered an issue but exam can continue",
        data: {
          timeRemaining,
          status: "in-progress",
          serverTime: Date.now(),
          error: error.message,
          continuable: true,
        },
      });
    } else {
      console.error(
        `Error after response already sent in updateTimeRemaining: ${error.message}`
      );
    }
  }
});

export default updateTimeRemaining;
