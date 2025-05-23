import Exam from "../../../models/exam.models.js";
import Question from "../../../models/questions.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";

const getLatestPublishedExams = catchAsync(async (req, res, next) => {
  // Get the clerkId from authenticated user
  const clerkId = req.user.sub;

  // Define constants for caching
  const LIMIT = 3;
  const cacheKey = `latest:published:${clerkId}:${LIMIT}`;

  let exams = null;
  let fromCache = false;

  // Try to get from Redis cache first
  try {
    const cachedExams = await examService.getCache(cacheKey);

    if (cachedExams) {
      exams = cachedExams;
      fromCache = true;
    }
  } catch (cacheError) {
    // Log cache error but continue to database query
    console.error("Cache error in getLatestPublishedExams:", cacheError);
    // We'll continue execution and try the database
  }

  // If we got data from cache, return it
  if (exams) {
    return res.status(200).json({
      status: "success",
      results: exams.length,
      fromCache, // Use the variable here
      data: {
        exams,
      },
    });
  }

  // If we get here, either there was no cached data or there was a cache error
  // Get the user ID using the clerk ID
  const userId = await getUserId(clerkId);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  try {
    // First, fetch latest exams with the required filters
    const latestExams = await Exam.find({
      isActive: true,
      $nor: [{ bundleTags: { $elemMatch: { $ne: "", $exists: true } } }],
    })
      .sort({ createdAt: -1 })
      .select("title description isActive duration totalMarks totalQuestions")
      .limit(LIMIT * 2) // Fetch more than needed as we'll filter some out
      .lean();

    // Process exams to check question count and attempt status
    const processedExams = await Promise.all(
      latestExams.map(async (exam) => {
        // Count questions for this exam
        const questionCount = await Question.countDocuments({
          examId: exam._id,
          isActive: true,
        });

        // Check if the question count matches totalQuestions
        if (questionCount !== exam.totalQuestions) {
          return null; // Skip this exam if counts don't match
        }

        // Check if user has attempted this exam
        const attemptExists = await ExamAttempt.exists({
          userId,
          examId: exam._id,
        });

        // Add the isAlreadyAttempted field
        return {
          ...exam,
          hasAttempted: !!attemptExists,
        };
      })
    );

    // Filter out null values and limit to LIMIT
    exams = processedExams.filter(Boolean).slice(0, LIMIT);

    // Only try to cache if we successfully got data
    if (exams && exams.length > 0) {
      try {
        await examService.setCache(cacheKey, exams, 5 * 60); // 5 minutes TTL
      } catch (cacheSetError) {
        // Just log the error but don't fail the request
        console.error("Failed to cache latest exams:", cacheSetError);
      }
    }

    return res.status(200).json({
      status: "success",
      results: exams.length,
      fromCache, // Use the variable here (will be false)
      data: {
        exams,
      },
    });
  } catch (dbError) {
    console.error("Database error in getLatestPublishedExams:", dbError);
    return next(new AppError("Failed to fetch latest exams", 500));
  }
});

export default getLatestPublishedExams;
