import mongoose from "mongoose";
import ExamAttempt from "../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { examService } from "../../services/redisService.js";
import { processExamSubmission } from "../../utils/processExamSubmission.js";

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
          // Wait with exponential backoff before retrying
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt - 1))
          );
        }
      } catch (error) {
        console.error(`Error acquiring lock (attempt ${attempt}/3):`, error);
      }
    }

    if (!lockAcquired) {
      // If we can't acquire lock after retries, inform user
      return next(
        new AppError(
          "System is currently processing your exam submission. Please try again in a few seconds.",
          429
        )
      );
    }

    // First check if the submission is already in progress or completed
    // This is an optimization to avoid unnecessary processing
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

    // Mark submission as processing
    await examService.set(examService.examCache, cacheKey, "processing", 60);

    // Basic checks for attempt validity - lean query for efficiency
    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      userId,
      status: { $in: ["in-progress", "timed-out"] },
    })
      .select("examId answers status")
      .lean();

    if (!attempt) {
      await examService.examCache.del(lockKey);
      return next(
        new AppError("Exam attempt not found or already completed", 404)
      );
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get exam details from cache
      const exam = await examService.getExam(attempt.examId.toString());
      if (!exam) {
        throw new Error("Exam not found");
      }

      // Get all answers from cache first
      const answerCacheKey = `attempt:${attemptId}:answers`;

      // Process evaluation in the background
      // This simulates moving the heavy computation to a queue
      // In production, this would be a separate worker process
      const evaluationResult = await processExamSubmission(
        attemptId,
        attempt,
        exam,
        session
      );

      await session.commitTransaction();
      session.endSession();

      // const dbAttempt = await ExamAttempt.findById({ _id: attemptId });

      // Submit completed - cache result for future requests
      await examService.set(
        examService.examCache,
        `submit:${attemptId}:result`,
        {
          status: "success",
          data: evaluationResult,
        },
        30 * 60
      );

      // Update status to completed
      await examService.set(
        examService.examCache,
        cacheKey,
        "completed",
        30 * 60
      );

      // Clean up answer cache to save memory
      await examService.del(examService.examCache, answerCacheKey);

      // Release lock
      await examService.examCache.del(lockKey);

      // Return result to client
      return res.status(200).json({
        status: "success",
        data: evaluationResult,
      });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();

      // Update status to failed
      await examService.set(examService.examCache, cacheKey, "failed", 5 * 60);

      console.error("Error submitting exam:", error);

      // Release lock
      await examService.examCache.del(lockKey);

      return next(new AppError("Failed to submit exam: " + error.message, 500));
    }
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
