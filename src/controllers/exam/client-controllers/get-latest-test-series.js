import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

const getLatestTestSeriesExams = catchAsync(async (req, res, next) => {
  // Define constants for caching
  const CATEGORY = "TEST SERIES";
  const LIMIT = 3;

  let exams = null;
  let fromCache = false;

  // Try to get from Redis cache first
  try {
    const cachedExams = await examService.getLatestExams(CATEGORY, LIMIT);

    if (cachedExams) {
      exams = cachedExams;
      fromCache = true;

      return res.status(200).json({
        status: "success",
        results: exams.length,
        fromCache: true,
        data: {
          exams,
        },
      });
    }
  } catch (cacheError) {
    // Log cache error but continue to database query
    console.error("Cache error in getLatestTestSeriesExams:", cacheError);
    // We'll continue execution and try the database
  }

  // If we get here, either there was no cached data or there was a cache error
  // In either case, we fallback to the database
  try {
    exams = await Exam.find({
      category: CATEGORY,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .select("title description isActive duration totalMarks")
      .limit(LIMIT)
      .lean();

    // Only try to cache if we successfully got data and there wasn't a cache error earlier
    if (exams && exams.length > 0) {
      try {
        await examService.setLatestExams(CATEGORY, LIMIT, exams, 1 * 60 * 60); // 5 minutes TTL
      } catch (cacheSetError) {
        // Just log the error but don't fail the request
        console.error("Failed to cache latest exams:", cacheSetError);
      }
    }

    return res.status(200).json({
      status: "success",
      results: exams.length,
      fromCache: false,
      data: {
        exams,
      },
    });
  } catch (dbError) {
    console.error("Database error in getLatestTestSeriesExams:", dbError);
    return next(new AppError("Failed to fetch latest exams", 500));
  }
});

export default getLatestTestSeriesExams;
