import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { questionService } from "../../../services/redisService.js";
import { checkExamExists } from "../../../utils/cachedDbQueries.js";

/**
 * Get all questions for a specific exam
 */
const getQuestionsByExam = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Check if exam exists
  const examExists = await checkExamExists(examId);
  if (!examExists) {
    return next(new AppError("Exam not found", 404));
  }

  // Try to get cached questions for this exam
  try {
    const cachedQuestions = await questionService.getQuestionsByExam(examId);
    if (cachedQuestions) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: {
          questions: cachedQuestions,
        },
      });
    }
  } catch (error) {
    console.error("Cache error in getQuestionsByExam:", error);
    // Continue to database query on cache error
  }

  // Fetch questions from database
  const questions = await Question.find({ examId })
    .sort({ createdAt: -1 })
    .select(
      "_id questionText type difficultyLevel category marks negativeMarks options statements statementInstruction explanation"
    );

  // Cache the questions for this exam
  try {
    await questionService.setQuestionsByExam(examId, questions, 3600);
  } catch (cacheError) {
    console.error("Failed to cache exam questions:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      questions,
    },
  });
});

export default getQuestionsByExam;
