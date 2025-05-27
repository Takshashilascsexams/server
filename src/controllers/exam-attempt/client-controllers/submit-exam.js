import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  examService,
  attemptService,
  queueExamSubmission,
} from "../../../services/redisService.js";

/**
 * Controller to submit an exam and calculate results
 * Optimized for high concurrency with 1000+ simultaneous submissions
 */

const submitExam = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token with read-through cache
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Use a unique write lock key to prevent concurrent evaluation of the same attempt
  const lockKey = `lock:attempt:${attemptId}`;
  let lockAcquired = false;

  try {
    // Try to acquire lock with exponential backoff (3 attempts)
    for (let attempt = 1; attempt <= 3 && !lockAcquired; attempt++) {
      try {
        // Set lock with 10 second expiry to prevent deadlocks
        lockAcquired = await examService.examCache.set(
          lockKey,
          Date.now(),
          "NX",
          "EX",
          10
        );

        if (!lockAcquired && attempt < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt - 1))
          );
        }
      } catch (error) {
        console.error(`Error acquiring lock (attempt ${attempt}/3):`, error);
      }
    }

    if (!lockAcquired) {
      return next(
        new AppError(
          "System is currently processing your exam submission. Please try again in a few seconds.",
          429
        )
      );
    }

    // Check if the submission is already in progress or completed
    const cacheKey = `submit:${attemptId}:status`;
    const submissionStatus = await examService.get(
      examService.examCache,
      cacheKey
    );

    if (submissionStatus === "completed") {
      // Already submitted and processed - return the cached result
      const resultKey = `submit:${attemptId}:result`;
      const cachedResult = await examService.get(
        examService.examCache,
        resultKey
      );

      if (cachedResult) {
        await examService.examCache.del(lockKey);
        return res.status(200).json(cachedResult);
      }
    } else if (submissionStatus === "processing") {
      // Submission in progress - ask client to poll
      await examService.examCache.del(lockKey);
      return res.status(202).json({
        status: "processing",
        message:
          "Your exam is being processed. Please check back in a few seconds.",
      });
    }

    // Basic checks for attempt validity - lean query for efficiency
    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      userId,
      status: { $in: ["in-progress", "timed-out"] },
    })
      .select("examId status")
      .lean();

    if (!attempt) {
      await examService.examCache.del(lockKey);
      return next(
        new AppError("Exam attempt not found or already completed", 404)
      );
    }

    // Mark submission as processing in both cache and database
    await examService.set(examService.examCache, cacheKey, "processing", 600); // 10 minutes expiry

    // Update the attempt status in the database to "processing"
    await ExamAttempt.updateOne(
      { _id: attemptId },
      { $set: { status: "processing" } }
    );

    // Save current timer state for the worker to use
    if (attempt.status === "in-progress") {
      try {
        // Get current timer data
        const timerData = await attemptService.getAttemptTimer(attemptId);

        if (timerData) {
          // Add a processing flag to the timer data
          await attemptService.setAttemptTimer(
            attemptId,
            {
              ...timerData,
              processingStarted: Date.now(),
            },
            600 // 10 minutes
          );
        }
      } catch (error) {
        console.log("Non-critical error updating timer state:", error);
      }
    }

    // Queue the exam for asynchronous processing
    const queueSuccess = await queueExamSubmission(attemptId, userId);

    if (!queueSuccess) {
      // If queueing fails, revert to synchronous processing (fallback)
      await examService.examCache.del(lockKey);
      return next(
        new AppError(
          "Failed to queue exam for processing. Please try again.",
          500
        )
      );
    }

    // Release lock
    await examService.examCache.del(lockKey);

    // Return immediate response to client
    return res.status(202).json({
      status: "processing",
      message: "Your exam has been submitted and is being processed",
      data: {
        attemptId,
        checkStatusUrl: `/api/attempt/${attemptId}/result-status`, // Provide URL for checking status
        estimatedProcessingTime: "5-10 seconds",
      },
    });
  } catch (error) {
    // Release lock if any error occurred
    if (lockAcquired) {
      await examService.examCache.del(lockKey);
    }

    console.error("Error in exam submission:", error);
    return next(new AppError("Failed to process exam submission", 500));
  }
});

export default submitExam;
