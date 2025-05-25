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
    // ✅ UPDATED: Fetch latest exams with attempt-related fields
    const latestExams = await Exam.find({
      isActive: true,
      $nor: [{ bundleTags: { $elemMatch: { $ne: "", $exists: true } } }],
    })
      .sort({ createdAt: -1 })
      .select(
        "title description isActive duration totalMarks totalQuestions allowMultipleAttempts maxAttempt"
      )
      .limit(LIMIT * 2) // Fetch more than needed as we'll filter some out
      .lean();

    // ✅ NEW: Get all exam attempts for this user to determine attempt access
    const allExamIds = latestExams.map((exam) => exam._id);
    const userAttempts = await ExamAttempt.find({
      userId,
      examId: { $in: allExamIds },
    })
      .select("examId status")
      .lean();

    // ✅ NEW: Create a map of exam attempts count per exam
    const attemptCountMap = {};
    userAttempts.forEach((attempt) => {
      const examId = attempt.examId.toString();
      if (!attemptCountMap[examId]) {
        attemptCountMap[examId] = 0;
      }
      attemptCountMap[examId]++;
    });

    // ✅ NEW: Helper function to determine attempt access
    const checkAttemptAccess = (exam) => {
      const examId = exam._id.toString();
      const attemptCount = attemptCountMap[examId] || 0;

      // If no attempts, access is always true
      if (attemptCount === 0) {
        return true;
      }

      // If multiple attempts are not allowed and user has attempted once
      if (!exam.allowMultipleAttempts && attemptCount >= 1) {
        return false;
      }

      // If multiple attempts are allowed, check against maxAttempt
      if (exam.allowMultipleAttempts && attemptCount >= exam.maxAttempt) {
        return false;
      }

      // User still has attempts remaining
      return true;
    };

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

        // ✅ UPDATED: Get attempt information for this specific exam
        const examId = exam._id.toString();
        const attemptCount = attemptCountMap[examId] || 0;
        const hasAttempted = attemptCount > 0;

        // ✅ NEW: Add attempt access information
        return {
          ...exam,
          hasAttempted,
          // ✅ NEW: Add attempt access fields
          hasAttemptAccess: checkAttemptAccess(exam),
          attemptCount,
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
