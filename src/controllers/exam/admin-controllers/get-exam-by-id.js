import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

/**
 * Get a single exam by ID
 * Used for editing exams
 */
const getExamById = catchAsync(async (req, res, next) => {
  const { id: examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Try to get from cache first
  const cacheKey = `admin:exam:${examId}`;
  try {
    const cachedData = await examService.get(examService.examCache, cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getExamById:", error);
    // Continue to database query on cache error
  }

  // Get exam details from database
  const exam = await Exam.findById(examId);

  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Prepare response data
  const responseData = {
    exam: exam.toJSON(),
  };

  // Cache the result for 5 minutes
  try {
    await examService.set(examService.examCache, cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache exam details:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getExamById;
