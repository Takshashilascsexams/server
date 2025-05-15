import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { questionService } from "../../../services/redisService.js";

/**
 * Get a single question by ID
 * Used for editing questions
 */
const getQuestionById = catchAsync(async (req, res, next) => {
  const { questionId } = req.params;

  if (!questionId) {
    return next(new AppError("Question ID is required", 400));
  }

  // Try to get from cache first
  try {
    const cachedQuestion = await questionService.getQuestion(questionId);
    if (cachedQuestion) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: {
          question: cachedQuestion,
        },
      });
    }
  } catch (error) {
    console.error("Cache error in getQuestionById:", error);
    // Continue to database query on cache error
  }

  // Get question details from database
  const question = await Question.findById(questionId);

  if (!question) {
    return next(new AppError("Question not found", 404));
  }

  // Cache the question for future requests (1 hour)
  try {
    await questionService.setQuestion(questionId, question.toJSON(), 3600);
  } catch (cacheError) {
    console.error("Failed to cache question details:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      question,
    },
  });
});

export default getQuestionById;
