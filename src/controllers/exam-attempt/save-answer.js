import ExamAttempt from "../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";

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
    return next(new AppError("Question not found in this exam attempt", 404));
  }

  // Check if this is the first time answering (for unattempted count)
  const wasUnattempted = attempt.answers[answerIndex].selectedOption === null;

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

  // Save the updated attempt
  await attempt.save();

  res.status(200).json({
    status: "success",
    message: "Answer saved successfully",
    data: {
      questionId,
      selectedOption,
      responseTime: attempt.answers[answerIndex].responseTime,
    },
  });
});

export default saveAnswer;
