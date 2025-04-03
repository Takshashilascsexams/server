import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";
import { examCategory } from "../../../utils/arrays.js";

const getCategorizedExams = catchAsync(async (req, res, next) => {
  // Get pagination parameters with defaults
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 6;
  const skip = (page - 1) * limit;

  // Try to get data from Redis cache first
  const cacheKey = `categorized:${page}:${limit}`;

  try {
    const cachedData = await examService.getExam(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        pagination: cachedData.pagination,
        data: cachedData.data,
      });
    }
  } catch (cacheError) {
    // Log cache error but continue to database query
    console.error("Cache error in getCategorizedExams:", cacheError);
  }

  // If we get here, we need to fetch from the database
  // Only fetch active exams for users
  const baseQuery = { isActive: true };

  try {
    // Create an object to store exams by category
    const categorizedExams = {};

    // Initialize with all possible categories from the enum
    examCategory.forEach((category) => {
      categorizedExams[category] = [];
    });

    // Get total count of active exams
    const total = await Exam.countDocuments(baseQuery);

    // Fetch all active exams with pagination
    const exams = await Exam.find(baseQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "title description category duration totalMarks difficultyLevel passMarkPercentage"
      )
      .lean();

    // Group exams by category
    exams.forEach((exam) => {
      if (categorizedExams[exam.category]) {
        categorizedExams[exam.category].push(exam);
      }
    });

    // Prepare response data
    const responseData = {
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
      data: {
        categorizedExams,
      },
    };

    // Cache the result for 1 hr
    try {
      await examService.setExam(cacheKey, responseData, 3600);
    } catch (cacheSetError) {
      console.error("Failed to cache categorized exams:", cacheSetError);
    }

    // Send response
    return res.status(200).json({
      status: "success",
      fromCache: false,
      pagination: responseData.pagination,
      data: responseData.data,
    });
  } catch (dbError) {
    console.error("Database error in getCategorizedExams:", dbError);
    return next(new AppError("Failed to fetch exams", 500));
  }
});

export default getCategorizedExams;
