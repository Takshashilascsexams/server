import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { attemptService } from "../../../services/redisService.js";

/**
 * Controller to save multiple answers for an exam attempt in a single request
 * - Optimized for high concurrency (500+ users)
 * - Uses Redis for immediate availability
 * - Updates MongoDB with efficient batch operations
 */
const saveBatchAnswers = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;
  const { answers } = req.body;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return next(new AppError("Valid answers array is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Check attempt existence and ownership using projection
  const attempt = await ExamAttempt.findOne({
    _id: attemptId,
    userId,
    status: "in-progress",
  })
    .select("_id answers unattempted")
    .lean();

  if (!attempt) {
    return next(new AppError("Exam attempt not found or not in progress", 404));
  }

  // Validate all question IDs exist in the attempt
  const validQuestionUpdates = [];
  let unattemptedChange = 0;

  // First pass: validate and process each answer
  for (const answer of answers) {
    const { questionId, selectedOption, responseTime } = answer;

    if (!questionId) {
      continue; // Skip invalid answers
    }

    // Find the answer in the attempt
    const answerIndex = attempt.answers.findIndex(
      (a) => a.questionId.toString() === questionId
    );

    if (answerIndex === -1) {
      continue; // Skip if question not found in attempt
    }

    // Check unattempted status changes
    const wasUnattempted = attempt.answers[answerIndex].selectedOption === null;
    const becomingUnattempted = selectedOption === null && !wasUnattempted;

    // Track unattempted count changes
    if (wasUnattempted && selectedOption !== null) {
      unattemptedChange -= 1;
    } else if (!wasUnattempted && selectedOption === null) {
      unattemptedChange += 1;
    }

    // Add to valid updates
    validQuestionUpdates.push({
      questionId,
      index: answerIndex,
      selectedOption,
      responseTime: responseTime || 0,
    });
  }

  if (validQuestionUpdates.length === 0) {
    return next(new AppError("No valid answers to update", 400));
  }

  try {
    // Use Redis batch save first for immediate consistency
    await attemptService.batchSaveAnswers(
      attemptId,
      validQuestionUpdates.map((update) => ({
        questionId: update.questionId,
        selectedOption: update.selectedOption,
        responseTime: update.responseTime,
      }))
    );

    // Prepare database updates - more efficient approach using direct update
    // with MongoDB's positional operator for arrays
    const bulkOperations = validQuestionUpdates.map((update) => ({
      updateOne: {
        filter: {
          _id: attemptId,
          userId,
          status: "in-progress",
          "answers.questionId": update.questionId,
        },
        update: {
          $set: {
            "answers.$.selectedOption": update.selectedOption,
            "answers.$.responseTime": update.responseTime,
          },
        },
      },
    }));

    // Execute batch updates
    await ExamAttempt.bulkWrite(bulkOperations, { ordered: false });

    // Update unattempted count if needed - separate operation for correctness
    if (unattemptedChange !== 0) {
      await ExamAttempt.updateOne(
        { _id: attemptId, userId, status: "in-progress" },
        { $inc: { unattempted: unattemptedChange } }
      );
    }

    res.status(200).json({
      status: "success",
      message: `Successfully saved ${validQuestionUpdates.length} answers`,
      data: {
        updatedCount: validQuestionUpdates.length,
        serverTime: Date.now(),
      },
    });
  } catch (error) {
    console.error(
      `Error saving batch answers for attempt ${attemptId}:`,
      error
    );
    return next(new AppError("Failed to save batch answers", 500));
  }
});

export default saveBatchAnswers;
