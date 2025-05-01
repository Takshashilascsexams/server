// src/controllers/exam-attempt/save-answer.js
import ExamAttempt from "../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { attemptService } from "../../services/redisService.js";

/**
 * Controller to save a user's answer for a question
 * - Optimized for high-frequency writes during concurrent exams
 * - Uses optimistic updates with versioning to prevent conflicts
 * - Implements efficient caching for faster response times
 */
const saveAnswer = catchAsync(async (req, res, next) => {
  const { attemptId, questionId } = req.params;
  const { selectedOption, responseTime } = req.body;

  if (!attemptId || !questionId) {
    return next(new AppError("Attempt ID and Question ID are required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // First check cache for quick response (user might be saving answers rapidly)
  const cacheKey = `answer:${attemptId}:${questionId}`;
  const attemptCacheKey = `attempt:${attemptId}`;

  let attempt;
  let needsDbUpdate = true;

  try {
    // Try to get cached attempt first
    attempt = await attemptService.getAttempt(attemptCacheKey);

    if (attempt) {
      // Verify ownership and status from cache
      if (attempt.userId.toString() !== userId.toString()) {
        return next(new AppError("Unauthorized access to this attempt", 403));
      }

      if (attempt.status !== "in-progress") {
        return next(
          new AppError(
            `This exam attempt is already ${attempt.status}. You cannot modify answers.`,
            400
          )
        );
      }

      // Find the answer in the cached attempt
      const answerIndex = attempt.answers.findIndex(
        (a) => a.questionId.toString() === questionId
      );

      if (answerIndex === -1) {
        // Question not found in attempt - will need full DB lookup
        needsDbUpdate = true;
      } else {
        // Check if this is just a duplicate of the last save (client retrying)
        const lastAnswer = attempt.answers[answerIndex];
        if (
          lastAnswer.selectedOption === selectedOption &&
          lastAnswer.responseTime === responseTime
        ) {
          // No change, just return success
          return res.status(200).json({
            status: "success",
            message: "Answer unchanged",
            data: {
              questionId,
              selectedOption,
              responseTime: lastAnswer.responseTime,
            },
          });
        }

        // Update cache
        const wasUnattempted =
          attempt.answers[answerIndex].selectedOption === null;

        // Update the answer in memory
        attempt.answers[answerIndex].selectedOption = selectedOption;
        attempt.answers[answerIndex].responseTime = responseTime || 0;

        // Update unattempted count
        if (wasUnattempted && selectedOption !== null) {
          attempt.unattempted -= 1;
        } else if (!wasUnattempted && selectedOption === null) {
          attempt.unattempted += 1;
        }

        // Update cache with changes
        await attemptService.setAttempt(attemptCacheKey, attempt, 2 * 60); // 2 minute TTL

        // Also cache just this answer for faster subsequent access
        await attemptService.setAttempt(
          cacheKey,
          {
            selectedOption,
            responseTime,
            updatedAt: new Date(),
          },
          5 * 60
        ); // 5 minute TTL
      }
    }
  } catch (error) {
    console.error(`Cache error for attempt ${attemptId}:`, error);
    // On cache error, fall back to database update
    needsDbUpdate = true;
  }

  // If we need to update the database (cache miss or cache error)
  if (needsDbUpdate) {
    // Use findOneAndUpdate with optimistic concurrency control
    const maxRetries = 3;
    let retryCount = 0;
    let updated = false;

    while (!updated && retryCount < maxRetries) {
      try {
        // Find the current version
        attempt = await ExamAttempt.findOne({
          _id: attemptId,
          userId,
        });

        if (!attempt) {
          return next(new AppError("Exam attempt not found", 404));
        }

        // Verify that the attempt is still in progress
        if (attempt.status !== "in-progress") {
          return next(
            new AppError(
              `This exam attempt is already ${attempt.status}. You cannot modify answers.`,
              400
            )
          );
        }

        // Find the answer in the attempt
        const answerIndex = attempt.answers.findIndex(
          (a) => a.questionId.toString() === questionId
        );

        if (answerIndex === -1) {
          return next(
            new AppError("Question not found in this exam attempt", 404)
          );
        }

        // Check if this is the first time answering (for unattempted count)
        const wasUnattempted =
          attempt.answers[answerIndex].selectedOption === null;

        // Update the answer
        attempt.answers[answerIndex].selectedOption = selectedOption;
        attempt.answers[answerIndex].responseTime = responseTime || 0;

        // Update unattempted count if needed
        if (wasUnattempted && selectedOption !== null) {
          attempt.unattempted -= 1;
        } else if (!wasUnattempted && selectedOption === null) {
          // If answer was cleared
          attempt.unattempted += 1;
        }

        // Save with version check
        await attempt.save();
        updated = true;

        // Update caches after successful save
        try {
          await attemptService.setAttempt(
            attemptCacheKey,
            attempt.toJSON(),
            2 * 60
          ); // 2 minute TTL

          await attemptService.setAttempt(
            cacheKey,
            {
              selectedOption,
              responseTime,
              updatedAt: new Date(),
            },
            5 * 60
          ); // 5 minute TTL
        } catch (cacheError) {
          // Just log but don't fail the request
          console.error(
            `Failed to update cache after save for ${attemptId}:`,
            cacheError
          );
        }
      } catch (error) {
        // If it's a version conflict, retry
        if (error.name === "VersionError") {
          retryCount++;
          // Small delay before retry to reduce contention
          await new Promise((resolve) => setTimeout(resolve, 50 * retryCount));
        } else {
          // For other errors, fail immediately
          console.error(`Error saving answer for ${attemptId}:`, error);
          return next(new AppError("Failed to save answer", 500));
        }
      }
    }

    if (!updated) {
      return next(
        new AppError(
          "Failed to save answer after multiple attempts. Please try again.",
          500
        )
      );
    }
  }

  // Respond with success
  res.status(200).json({
    status: "success",
    message: "Answer saved successfully",
    data: {
      questionId,
      selectedOption,
      responseTime: responseTime || 0,
    },
  });
});

// Optimized batch save for multiple answers at once (useful for poor connections)
const saveMultipleAnswers = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;
  const { answers } = req.body; // Array of {questionId, selectedOption, responseTime}

  if (
    !attemptId ||
    !answers ||
    !Array.isArray(answers) ||
    answers.length === 0
  ) {
    return next(
      new AppError("Attempt ID and valid answers array are required", 400)
    );
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Use findOneAndUpdate with optimistic concurrency control
  const maxRetries = 3;
  let retryCount = 0;
  let updated = false;
  let attempt;

  while (!updated && retryCount < maxRetries) {
    try {
      // Find the current version
      attempt = await ExamAttempt.findOne({
        _id: attemptId,
        userId,
      });

      if (!attempt) {
        return next(new AppError("Exam attempt not found", 404));
      }

      // Verify that the attempt is still in progress
      if (attempt.status !== "in-progress") {
        return next(
          new AppError(
            `This exam attempt is already ${attempt.status}. You cannot modify answers.`,
            400
          )
        );
      }

      // Create a map for quick lookups
      const answersMap = new Map();
      attempt.answers.forEach((answer, index) => {
        answersMap.set(answer.questionId.toString(), { answer, index });
      });

      // Track changes to unattempted count
      let unattemptedDelta = 0;

      // Process each answer
      for (const { questionId, selectedOption, responseTime } of answers) {
        const answerInfo = answersMap.get(questionId);

        if (!answerInfo) {
          continue; // Skip invalid question IDs
        }

        const { answer, index } = answerInfo;
        const wasUnattempted = answer.selectedOption === null;

        // Update the answer
        attempt.answers[index].selectedOption = selectedOption;
        attempt.answers[index].responseTime = responseTime || 0;

        // Update unattempted count delta
        if (wasUnattempted && selectedOption !== null) {
          unattemptedDelta -= 1;
        } else if (!wasUnattempted && selectedOption === null) {
          unattemptedDelta += 1;
        }
      }

      // Apply unattempted delta
      attempt.unattempted += unattemptedDelta;

      // Save with version check
      await attempt.save();
      updated = true;

      // Update cache after successful save
      try {
        await attemptService.setAttempt(
          `attempt:${attemptId}`,
          attempt.toJSON(),
          2 * 60
        );

        // Also cache individual answers
        for (const { questionId, selectedOption, responseTime } of answers) {
          await attemptService.setAttempt(
            `answer:${attemptId}:${questionId}`,
            {
              selectedOption,
              responseTime,
              updatedAt: new Date(),
            },
            5 * 60
          );
        }
      } catch (cacheError) {
        // Just log but don't fail the request
        console.error(
          `Failed to update cache after batch save for ${attemptId}:`,
          cacheError
        );
      }
    } catch (error) {
      // If it's a version conflict, retry
      if (error.name === "VersionError") {
        retryCount++;
        // Small delay before retry to reduce contention
        await new Promise((resolve) => setTimeout(resolve, 50 * retryCount));
      } else {
        // For other errors, fail immediately
        console.error(`Error saving multiple answers for ${attemptId}:`, error);
        return next(new AppError("Failed to save answers", 500));
      }
    }
  }

  if (!updated) {
    return next(
      new AppError(
        "Failed to save answers after multiple attempts. Please try again.",
        500
      )
    );
  }

  // Respond with success
  res.status(200).json({
    status: "success",
    message: "Answers saved successfully",
    data: {
      attemptId,
      savedCount: answers.length,
    },
  });
});

export { saveAnswer as default, saveMultipleAnswers };
