import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { dashboardService } from "../../../services/redisService.js";

/**
 * Controller to get detailed performance metrics for dashboard charts
 * - Exam performance over time
 * - Pass rate trends
 * - Student participation metrics
 * - Score distribution analytics
 */
const getPerformanceMetrics = catchAsync(async (req, res, next) => {
  const { timeRange = "7d", metric = "all" } = req.query;
  const cacheKey = `performance:${timeRange}:${metric}`;

  // Try to get from cache first
  try {
    const cachedMetrics = await dashboardService.getPerformanceData(timeRange);
    if (cachedMetrics) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedMetrics,
      });
    }
  } catch (error) {
    console.error("Cache error in getPerformanceMetrics:", error);
  }

  try {
    // Parse time range
    const { startDate, endDate, groupBy } = parseTimeRange(timeRange);

    // Get performance data based on requested metrics
    let performanceData = {};

    if (metric === "all" || metric === "overview") {
      performanceData.overview = await getOverviewMetrics(startDate, endDate);
    }

    if (metric === "all" || metric === "trends") {
      performanceData.trends = await getTrendMetrics(
        startDate,
        endDate,
        groupBy
      );
    }

    if (metric === "all" || metric === "distribution") {
      performanceData.distribution = await getScoreDistribution(
        startDate,
        endDate
      );
    }

    if (metric === "all" || metric === "participation") {
      performanceData.participation = await getParticipationMetrics(
        startDate,
        endDate,
        groupBy
      );
    }

    if (metric === "all" || metric === "exam-wise") {
      performanceData.examWise = await getExamWiseMetrics(startDate, endDate);
    }

    // Add metadata
    performanceData.metadata = {
      timeRange,
      startDate,
      endDate,
      generatedAt: new Date(),
      totalDataPoints: await ExamAttempt.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate },
      }),
    };

    // Cache the results
    try {
      await dashboardService.setPerformanceData(
        timeRange,
        performanceData,
        5 * 60
      );
    } catch (cacheError) {
      console.error("Failed to cache performance metrics:", cacheError);
    }

    // Send response
    res.status(200).json({
      status: "success",
      fromCache: false,
      data: performanceData,
    });
  } catch (dbError) {
    console.error("Database error in getPerformanceMetrics:", dbError);
    return next(new AppError("Failed to fetch performance metrics", 500));
  }
});

/**
 * Parse time range parameter
 */
const parseTimeRange = (timeRange) => {
  const now = new Date();
  let startDate, endDate, groupBy;

  switch (timeRange) {
    case "24h":
      startDate = new Date(now - 24 * 60 * 60 * 1000);
      endDate = now;
      groupBy = "hour";
      break;
    case "7d":
      startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
      groupBy = "day";
      break;
    case "30d":
      startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
      groupBy = "day";
      break;
    case "90d":
      startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
      endDate = now;
      groupBy = "week";
      break;
    case "1y":
      startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
      endDate = now;
      groupBy = "month";
      break;
    default:
      startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      endDate = now;
      groupBy = "day";
  }

  return { startDate, endDate, groupBy };
};

/**
 * Get overview metrics
 */
const getOverviewMetrics = async (startDate, endDate) => {
  try {
    const [totalAttempts, completedAttempts, passedAttempts, averageScoreData] =
      await Promise.all([
        ExamAttempt.countDocuments({
          createdAt: { $gte: startDate, $lte: endDate },
        }),
        ExamAttempt.countDocuments({
          createdAt: { $gte: startDate, $lte: endDate },
          status: "completed",
        }),
        ExamAttempt.countDocuments({
          createdAt: { $gte: startDate, $lte: endDate },
          status: "completed",
          hasPassed: true,
        }),
        ExamAttempt.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              status: "completed",
            },
          },
          {
            $lookup: {
              from: "exams",
              localField: "examId",
              foreignField: "_id",
              as: "exam",
            },
          },
          { $unwind: "$exam" },
          {
            $group: {
              _id: null,
              averageScore: {
                $avg: {
                  $multiply: [
                    { $divide: ["$finalScore", "$exam.totalMarks"] },
                    100,
                  ],
                },
              },
              highestScore: {
                $max: {
                  $multiply: [
                    { $divide: ["$finalScore", "$exam.totalMarks"] },
                    100,
                  ],
                },
              },
              lowestScore: {
                $min: {
                  $multiply: [
                    { $divide: ["$finalScore", "$exam.totalMarks"] },
                    100,
                  ],
                },
              },
            },
          },
        ]),
      ]);

    const averageScore =
      averageScoreData.length > 0 ? averageScoreData[0].averageScore : 0;
    const highestScore =
      averageScoreData.length > 0 ? averageScoreData[0].highestScore : 0;
    const lowestScore =
      averageScoreData.length > 0 ? averageScoreData[0].lowestScore : 0;

    const passRate =
      completedAttempts > 0 ? (passedAttempts / completedAttempts) * 100 : 0;
    const completionRate =
      totalAttempts > 0 ? (completedAttempts / totalAttempts) * 100 : 0;

    return {
      totalAttempts,
      completedAttempts,
      passedAttempts,
      passRate: Math.round(passRate * 100) / 100,
      completionRate: Math.round(completionRate * 100) / 100,
      averageScore: Math.round(averageScore * 100) / 100,
      highestScore: Math.round(highestScore * 100) / 100,
      lowestScore: Math.round(lowestScore * 100) / 100,
    };
  } catch (error) {
    console.error("Error getting overview metrics:", error);
    return {
      totalAttempts: 0,
      completedAttempts: 0,
      passedAttempts: 0,
      passRate: 0,
      completionRate: 0,
      averageScore: 0,
      highestScore: 0,
      lowestScore: 0,
    };
  }
};

/**
 * Get trend metrics over time
 */
const getTrendMetrics = async (startDate, endDate, groupBy) => {
  try {
    // Create date grouping based on groupBy parameter
    let dateGroup;
    let dateFormat;

    switch (groupBy) {
      case "hour":
        dateGroup = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
          hour: { $hour: "$createdAt" },
        };
        dateFormat = "%Y-%m-%d %H:00";
        break;
      case "day":
        dateGroup = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
        };
        dateFormat = "%Y-%m-%d";
        break;
      case "week":
        dateGroup = {
          year: { $year: "$createdAt" },
          week: { $week: "$createdAt" },
        };
        dateFormat = "%Y-W%U";
        break;
      case "month":
        dateGroup = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        };
        dateFormat = "%Y-%m";
        break;
      default:
        dateGroup = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
        };
        dateFormat = "%Y-%m-%d";
    }

    const trendData = await ExamAttempt.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: dateGroup,
          totalAttempts: { $sum: 1 },
          completedAttempts: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          passedAttempts: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "completed"] },
                    { $eq: ["$hasPassed", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalScore: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$finalScore", 0],
            },
          },
          totalPossibleScore: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$totalMarks", 0],
            },
          },
        },
      },
      {
        $addFields: {
          passRate: {
            $cond: [
              { $gt: ["$completedAttempts", 0] },
              {
                $multiply: [
                  { $divide: ["$passedAttempts", "$completedAttempts"] },
                  100,
                ],
              },
              0,
            ],
          },
          averageScore: {
            $cond: [
              { $gt: ["$totalPossibleScore", 0] },
              {
                $multiply: [
                  { $divide: ["$totalScore", "$totalPossibleScore"] },
                  100,
                ],
              },
              0,
            ],
          },
          completionRate: {
            $cond: [
              { $gt: ["$totalAttempts", 0] },
              {
                $multiply: [
                  { $divide: ["$completedAttempts", "$totalAttempts"] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } },
    ]);

    // Format the data for chart consumption
    const formattedData = trendData.map((item) => ({
      date: formatDateGroup(item._id, groupBy),
      totalAttempts: item.totalAttempts,
      completedAttempts: item.completedAttempts,
      passedAttempts: item.passedAttempts,
      passRate: Math.round(item.passRate * 100) / 100,
      averageScore: Math.round(item.averageScore * 100) / 100,
      completionRate: Math.round(item.completionRate * 100) / 100,
    }));

    return formattedData;
  } catch (error) {
    console.error("Error getting trend metrics:", error);
    return [];
  }
};

/**
 * Get score distribution
 */
const getScoreDistribution = async (startDate, endDate) => {
  try {
    const distribution = await ExamAttempt.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: "completed",
        },
      },
      {
        $lookup: {
          from: "exams",
          localField: "examId",
          foreignField: "_id",
          as: "exam",
        },
      },
      { $unwind: "$exam" },
      {
        $addFields: {
          scorePercentage: {
            $multiply: [{ $divide: ["$finalScore", "$exam.totalMarks"] }, 100],
          },
        },
      },
      {
        $bucket: {
          groupBy: "$scorePercentage",
          boundaries: [0, 20, 40, 60, 80, 100],
          default: "100+",
          output: {
            count: { $sum: 1 },
            averageScore: { $avg: "$scorePercentage" },
          },
        },
      },
    ]);

    // Format score ranges
    const scoreRanges = [
      { range: "0-20%", min: 0, max: 20 },
      { range: "21-40%", min: 20, max: 40 },
      { range: "41-60%", min: 40, max: 60 },
      { range: "61-80%", min: 60, max: 80 },
      { range: "81-100%", min: 80, max: 100 },
    ];

    const formattedDistribution = scoreRanges.map((range) => {
      const bucketData = distribution.find((d) => d._id === range.min);
      return {
        range: range.range,
        count: bucketData ? bucketData.count : 0,
        averageScore: bucketData
          ? Math.round(bucketData.averageScore * 100) / 100
          : 0,
      };
    });

    return formattedDistribution;
  } catch (error) {
    console.error("Error getting score distribution:", error);
    return [];
  }
};

/**
 * Get participation metrics
 */
const getParticipationMetrics = async (startDate, endDate, groupBy) => {
  try {
    const [totalStudents, participationTrend] = await Promise.all([
      User.countDocuments({ role: "Student" }),
      ExamAttempt.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            uniqueStudents: { $addToSet: "$userId" },
            totalAttempts: { $sum: 1 },
          },
        },
        {
          $addFields: {
            uniqueStudentCount: { $size: "$uniqueStudents" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
    ]);

    const formattedParticipation = participationTrend.map((item) => ({
      date: formatDateGroup(item._id, "day"),
      uniqueStudents: item.uniqueStudentCount,
      totalAttempts: item.totalAttempts,
      participationRate:
        totalStudents > 0
          ? Math.round((item.uniqueStudentCount / totalStudents) * 100 * 100) /
            100
          : 0,
    }));

    return {
      totalStudents,
      trend: formattedParticipation,
    };
  } catch (error) {
    console.error("Error getting participation metrics:", error);
    return {
      totalStudents: 0,
      trend: [],
    };
  }
};

/**
 * Get exam-wise performance metrics
 */
const getExamWiseMetrics = async (startDate, endDate) => {
  try {
    const examMetrics = await ExamAttempt.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: "completed",
        },
      },
      {
        $group: {
          _id: "$examId",
          totalAttempts: { $sum: 1 },
          passedAttempts: {
            $sum: { $cond: [{ $eq: ["$hasPassed", true] }, 1, 0] },
          },
          averageScore: { $avg: "$finalScore" },
          highestScore: { $max: "$finalScore" },
          lowestScore: { $min: "$finalScore" },
          averageTime: { $avg: "$responseTime" },
        },
      },
      {
        $lookup: {
          from: "exams",
          localField: "_id",
          foreignField: "_id",
          as: "exam",
        },
      },
      { $unwind: "$exam" },
      {
        $addFields: {
          passRate: {
            $multiply: [
              { $divide: ["$passedAttempts", "$totalAttempts"] },
              100,
            ],
          },
          averageScorePercentage: {
            $multiply: [
              { $divide: ["$averageScore", "$exam.totalMarks"] },
              100,
            ],
          },
        },
      },
      {
        $project: {
          examTitle: "$exam.title",
          examCategory: "$exam.category",
          totalMarks: "$exam.totalMarks",
          totalAttempts: 1,
          passedAttempts: 1,
          passRate: { $round: ["$passRate", 2] },
          averageScore: { $round: ["$averageScore", 2] },
          averageScorePercentage: { $round: ["$averageScorePercentage", 2] },
          highestScore: 1,
          lowestScore: 1,
          averageTime: { $round: ["$averageTime", 0] },
        },
      },
      { $sort: { passRate: -1, totalAttempts: -1 } },
      { $limit: 10 }, // Top 10 exams
    ]);

    return examMetrics;
  } catch (error) {
    console.error("Error getting exam-wise metrics:", error);
    return [];
  }
};

/**
 * Format date group for display
 */
const formatDateGroup = (dateGroup, groupBy) => {
  switch (groupBy) {
    case "hour":
      return `${dateGroup.year}-${String(dateGroup.month).padStart(
        2,
        "0"
      )}-${String(dateGroup.day).padStart(2, "0")} ${String(
        dateGroup.hour
      ).padStart(2, "0")}:00`;
    case "day":
      return `${dateGroup.year}-${String(dateGroup.month).padStart(
        2,
        "0"
      )}-${String(dateGroup.day).padStart(2, "0")}`;
    case "week":
      return `${dateGroup.year}-W${String(dateGroup.week).padStart(2, "0")}`;
    case "month":
      return `${dateGroup.year}-${String(dateGroup.month).padStart(2, "0")}`;
    default:
      return `${dateGroup.year}-${String(dateGroup.month).padStart(
        2,
        "0"
      )}-${String(dateGroup.day).padStart(2, "0")}`;
  }
};

export default getPerformanceMetrics;
