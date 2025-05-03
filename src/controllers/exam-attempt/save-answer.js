import ExamAttempt from "../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { attemptService } from "../../services/redisService.js";

/**
 * Controller to save a user's answer for a question
 * - Updates the answer in the attempt record
 * - Updates response time
 * - Does not calculate correct/incorrect or marks yet
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

  // Check attempt existence and ownership using a single query with projection
  // This reduces data transfer over the network
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

  // Find the answer in the attempt
  const answerIndex = attempt.answers.findIndex(
    (a) => a.questionId.toString() === questionId
  );

  if (answerIndex === -1) {
    return next(new AppError("Question not found in this exam attempt", 404));
  }

  // Check if this is the first time answering (for unattempted count)
  const wasUnattempted = attempt.answers[answerIndex].selectedOption === null;
  const becomingUnattempted =
    selectedOption === null && wasUnattempted === false;

  // Determine unattempted count change
  let unattemptedChange = 0;
  if (wasUnattempted && selectedOption !== null) {
    unattemptedChange = -1;
  } else if (!wasUnattempted && selectedOption === null) {
    unattemptedChange = 1;
  }

  // Use batch operation to update the answer in Redis first for immediate consistency
  await attemptService.batchSaveAnswers(attemptId, [
    {
      questionId,
      selectedOption,
      responseTime: responseTime || 0,
    },
  ]);

  // Then use atomic update in database (updateOne is more efficient than findOne + save)
  // This also prevents race conditions
  const updateOperation = {
    $set: {
      [`answers.${answerIndex}.selectedOption`]: selectedOption,
      [`answers.${answerIndex}.responseTime`]: responseTime || 0,
    },
  };

  // Only update unattempted count if it changed
  if (unattemptedChange !== 0) {
    updateOperation.$inc = { unattempted: unattemptedChange };
  }

  await ExamAttempt.updateOne(
    { _id: attemptId, userId, status: "in-progress" },
    updateOperation
  );

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

export default saveAnswer;
