import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { userService } from "../../../services/redisService.js";

/**
 * Controller to get user's exam results for profile page
 * - Returns all completed attempts with exam details
 * - Includes pass/fail status and scores
 * - Optimized for profile display with caching
 */
const getUserResults = catchAsync(async (req, res, next) => {
  // Get pagination parameters with defaults
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Get sorting parameters
  const sortBy = req.query.sortBy || "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  // Get filter parameters
  const status = req.query.status; // completed, failed, passed
  const examCategory = req.query.category; // filter by exam category

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  const userIdString = userId.toString();

  // Create cache key based on parameters
  const cacheKey = `profile:results:${userIdString}:${JSON.stringify({
    page,
    limit,
    sortBy,
    sortOrder,
    status,
    examCategory,
  })}`;

  // Try to get from cache first
  try {
    const cachedData = await userService.getUserResults(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (cacheError) {
    console.error("Cache error in getUserResults:", cacheError);
  }

  try {
    // Build query for user's attempts
    const attemptQuery = {
      userId,
      status: { $in: ["completed", "timed-out"] }, // Only show finished attempts
    };

    // Add status filter if provided
    if (status === "passed") {
      attemptQuery.hasPassed = true;
    } else if (status === "failed") {
      attemptQuery.hasPassed = false;
    }

    // Get user's exam attempts with exam details
    const attempts = await ExamAttempt.find(attemptQuery)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({
        path: "examId",
        select:
          "title description category totalMarks passMarkPercentage isPremium isFeatured",
        match: examCategory ? { category: examCategory } : {},
      })
      .lean();

    // Filter out attempts where exam population failed (due to category filter)
    const validAttempts = attempts.filter((attempt) => attempt.examId);

    // Get total count for pagination (accounting for filters)
    let totalQuery = { ...attemptQuery };
    if (examCategory) {
      // For total count with category filter, we need to use aggregation
      const totalCountPipeline = [
        { $match: totalQuery },
        {
          $lookup: {
            from: "exams",
            localField: "examId",
            foreignField: "_id",
            as: "exam",
          },
        },
        { $unwind: "$exam" },
        { $match: { "exam.category": examCategory } },
        { $count: "total" },
      ];

      const totalResult = await ExamAttempt.aggregate(totalCountPipeline);
      var total = totalResult[0]?.total || 0;
    } else {
      var total = await ExamAttempt.countDocuments(totalQuery);
    }

    // Format the results for profile display
    const formattedResults = validAttempts.map((attempt) => {
      const exam = attempt.examId;
      const percentage =
        exam.totalMarks > 0
          ? ((attempt.finalScore / exam.totalMarks) * 100).toFixed(1)
          : 0;

      // Calculate time taken
      const timeTaken =
        attempt.endTime && attempt.startTime
          ? Math.floor(
              (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
            )
          : exam.duration * 60;

      // Format time in readable format
      const formatTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours > 0 ? hours + "h " : ""}${minutes}m ${secs}s`;
      };

      return {
        attemptId: attempt._id,
        exam: {
          id: exam._id,
          title: exam.title,
          description: exam.description,
          category: exam.category,
          isPremium: exam.isPremium,
          isFeatured: exam.isFeatured,
          totalMarks: exam.totalMarks,
          passMarkPercentage: exam.passMarkPercentage,
        },
        score: {
          obtained: attempt.finalScore,
          total: exam.totalMarks,
          percentage: parseFloat(percentage),
        },
        performance: {
          hasPassed: attempt.hasPassed,
          correctAnswers: attempt.correctAnswers,
          wrongAnswers: attempt.wrongAnswers,
          unattempted: attempt.unattempted,
          negativeMarks: attempt.negativeMarks || 0,
        },
        timing: {
          timeTaken: timeTaken,
          timeTakenFormatted: formatTime(timeTaken),
          attemptedOn: attempt.createdAt,
          completedOn: attempt.endTime || attempt.updatedAt,
        },
        ranking: {
          rank: attempt.rank || null,
          percentile: attempt.percentile || null,
        },
        // URL for detailed results page
        resultUrl: `/results/${attempt._id}`,
      };
    });

    // Calculate summary statistics
    const summary = {
      totalAttempts: formattedResults.length,
      passedAttempts: formattedResults.filter((r) => r.performance.hasPassed)
        .length,
      failedAttempts: formattedResults.filter((r) => !r.performance.hasPassed)
        .length,
      averageScore:
        formattedResults.length > 0
          ? (
              formattedResults.reduce((sum, r) => sum + r.score.percentage, 0) /
              formattedResults.length
            ).toFixed(1)
          : 0,
      highestScore:
        formattedResults.length > 0
          ? Math.max(
              ...formattedResults.map((r) => r.score.percentage)
            ).toFixed(1)
          : 0,
    };

    // Prepare response data
    const responseData = {
      results: formattedResults,
      summary,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    };

    // Cache the result for 5 minutes
    try {
      await userService.setUserResults(cacheKey, responseData, 5 * 60);
    } catch (cacheSetError) {
      console.error("Failed to cache user results:", cacheSetError);
    }

    // Send response
    return res.status(200).json({
      status: "success",
      fromCache: false,
      data: responseData,
    });
  } catch (dbError) {
    console.error("Database error in getUserResults:", dbError);
    return next(new AppError("Failed to fetch user results", 500));
  }
});

/**
 * Controller to get user's results summary for profile dashboard
 * - Returns high-level statistics without pagination
 * - Optimized for dashboard widgets
 */
const getUserResultsSummary = catchAsync(async (req, res, next) => {
  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  const userIdString = userId.toString();
  const cacheKey = `profile:summary:${userIdString}`;

  // Try to get from cache first
  try {
    const cachedData = await userService.getUserResultsSummary(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (cacheError) {
    console.error("Cache error in getUserResultsSummary:", cacheError);
  }

  try {
    // Get all completed attempts for this user
    const attempts = await ExamAttempt.find({
      userId,
      status: { $in: ["completed", "timed-out"] },
    })
      .populate({
        path: "examId",
        select: "title category totalMarks isPremium",
      })
      .lean();

    // Filter valid attempts
    const validAttempts = attempts.filter((attempt) => attempt.examId);

    // Calculate comprehensive statistics
    const stats = {
      totalAttempts: validAttempts.length,
      completedAttempts: validAttempts.filter((a) => a.status === "completed")
        .length,
      timedOutAttempts: validAttempts.filter((a) => a.status === "timed-out")
        .length,
      passedAttempts: validAttempts.filter((a) => a.hasPassed).length,
      failedAttempts: validAttempts.filter((a) => !a.hasPassed).length,
      passRate:
        validAttempts.length > 0
          ? (
              (validAttempts.filter((a) => a.hasPassed).length /
                validAttempts.length) *
              100
            ).toFixed(1)
          : 0,
    };

    // Score statistics
    const scores = validAttempts
      .filter((a) => a.examId && a.examId.totalMarks > 0)
      .map((a) => (a.finalScore / a.examId.totalMarks) * 100);

    if (scores.length > 0) {
      stats.averageScore = (
        scores.reduce((sum, score) => sum + score, 0) / scores.length
      ).toFixed(1);
      stats.highestScore = Math.max(...scores).toFixed(1);
      stats.lowestScore = Math.min(...scores).toFixed(1);
    } else {
      stats.averageScore = 0;
      stats.highestScore = 0;
      stats.lowestScore = 0;
    }

    // Category breakdown
    const categoryStats = {};
    validAttempts.forEach((attempt) => {
      const category = attempt.examId?.category || "OTHER";
      if (!categoryStats[category]) {
        categoryStats[category] = {
          total: 0,
          passed: 0,
          failed: 0,
        };
      }
      categoryStats[category].total++;
      if (attempt.hasPassed) {
        categoryStats[category].passed++;
      } else {
        categoryStats[category].failed++;
      }
    });

    // Recent attempts (last 5)
    const recentAttempts = validAttempts
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5)
      .map((attempt) => ({
        attemptId: attempt._id,
        examTitle: attempt.examId?.title || "Unknown Exam",
        score:
          attempt.examId?.totalMarks > 0
            ? ((attempt.finalScore / attempt.examId.totalMarks) * 100).toFixed(
                1
              )
            : 0,
        hasPassed: attempt.hasPassed,
        attemptedOn: attempt.createdAt,
        resultUrl: `/results/${attempt._id}`,
      }));

    const responseData = {
      statistics: stats,
      categoryBreakdown: categoryStats,
      recentAttempts,
    };

    // Cache the result for 10 minutes
    try {
      await userService.setUserResultsSummary(cacheKey, responseData, 10 * 60);
    } catch (cacheSetError) {
      console.error("Failed to cache user results summary:", cacheSetError);
    }

    // Send response
    return res.status(200).json({
      status: "success",
      fromCache: false,
      data: responseData,
    });
  } catch (dbError) {
    console.error("Database error in getUserResultsSummary:", dbError);
    return next(new AppError("Failed to fetch user results summary", 500));
  }
});

export { getUserResults, getUserResultsSummary };
