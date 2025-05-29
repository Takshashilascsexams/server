import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { questionService } from "../../../services/redisService.js";

/**
 * Delete a question
 */
const deleteQuestion = catchAsync(async (req, res, next) => {
  const { questionId } = req.params;

  if (!questionId) {
    return next(new AppError("Question ID is required", 400));
  }

  // Find the question first to get its examId for cache invalidation
  const question = await Question.findById(questionId);

  if (!question) {
    return next(new AppError("Question not found", 404));
  }

  // Store the examId for cache invalidation
  const examId = question.examId;

  // Delete the question
  await Question.findByIdAndDelete(questionId);

  // 1. Delete from question cache
  await questionService.deleteQuestion(questionId);

  // 2. Clear exam-specific question caches
  await questionService.clearExamQuestionsCache(examId);

  // 3. Invalidate dashboard question cache
  await questionService.clearDashboardCache();

  // Update the question count for this exam
  try {
    const count = await Question.countDocuments({ examId });
    await questionService.updateExamQuestionCount(examId, count);
  } catch (countError) {
    console.error("Error updating question count:", countError);
    // Non-critical error, continue execution
  }

  // Send response
  res.status(200).json({
    status: "success",
    message: "Question deleted successfully",
  });
});

export default deleteQuestion;
