import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { publicationService } from "../../../services/redisService.js";

/**
 * Controller to get user's exam attempts for profile page
 * - Returns minimal data for displaying attempt links
 * - Includes pagination for better performance
 * - Only shows completed and timed-out attempts (viewable results)
 */
const getUserExamAttempts = catchAsync(async (req, res, next) => {
  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  const {
    page = 1,
    limit = 10,
    status = "completed,timed-out", // Only attempts with viewable results
  } = req.query;

  // Create cache key based on user and query parameters
  const cacheKey = `user:${userId}:attempts:${page}:${limit}:${status}`;

  // Try to get from cache first
  try {
    const cachedData = await publicationService.getUserExamAttempts(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getUserExamAttempts:", error);
  }

  // Build query for database
  const query = { userId };

  // Add status filter if provided
  if (status && status !== "all") {
    const statusArray = status.split(",").map((s) => s.trim());
    query.status = { $in: statusArray };
  }

  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Fetch attempts with minimal required data
  const attempts = await ExamAttempt.find(query)
    .sort({ createdAt: -1 }) // Latest attempts first
    .skip(skip)
    .limit(parseInt(limit))
    .populate({
      path: "examId",
      select: "title category totalMarks totalQuestions", // Minimal exam data
    })
    .select(
      "_id examId status finalScore hasPassed createdAt endTime rank percentile"
    )
    .lean();

  // Get total count for pagination
  const total = await ExamAttempt.countDocuments(query);

  // Format the response data
  const formattedAttempts = attempts.map((attempt) => ({
    attemptId: attempt._id,
    exam: {
      id: attempt.examId?._id,
      title: attempt.examId?.title || "Unknown Exam",
      category: attempt.examId?.category || "General",
      totalMarks: attempt.examId?.totalMarks || 0,
      totalQuestions: attempt.examId?.totalQuestions || 0,
    },
    performance: {
      score: attempt.finalScore || 0,
      percentage: attempt.examId?.totalMarks
        ? ((attempt.finalScore / attempt.examId.totalMarks) * 100).toFixed(1)
        : "0.0",
      hasPassed: attempt.hasPassed || false,
    },
    ranking: {
      rank: attempt.rank || null,
      percentile: attempt.percentile || null,
    },
    timing: {
      attemptedOn: attempt.createdAt,
      completedOn: attempt.endTime,
    },
    status: attempt.status,
  }));

  // Prepare response data
  const responseData = {
    attempts: formattedAttempts,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };

  // Cache the result for 5 minutes
  try {
    await publicationService.setUserExamAttempts(cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache user exam attempts:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getUserExamAttempts;
