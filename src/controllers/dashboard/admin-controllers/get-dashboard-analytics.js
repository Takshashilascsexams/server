import Exam from "../../../models/exam.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Question from "../../../models/questions.models.js";
import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { dashboardService } from "../../../services/redisService.js";

/**
 * Controller to get comprehensive dashboard analytics
 * - Advanced metrics and insights
 * - Comparative analysis
 * - Trend predictions
 * - Performance insights
 */
const getDashboardAnalytics = catchAsync(async (req, res, next) => {
  const {
    timeRange = "30d",
    compareWith = "previous",
    includeForecasts = "false",
  } = req.query;

  const cacheKey = `analytics:dashboard:${timeRange}:${compareWith}:${includeForecasts}`;

  // Try to get from cache first
  try {
    const cachedAnalytics = await dashboardService.getAnalyticsAggregation(
      "dashboard",
      timeRange
    );
    if (cachedAnalytics) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedAnalytics,
      });
    }
  } catch (error) {
    console.error("Cache error in getDashboardAnalytics:", error);
  }

  try {
    // Parse time ranges
    const { currentPeriod, comparisonPeriod } = parseAnalyticsTimeRange(
      timeRange,
      compareWith
    );

    // Get comprehensive analytics data
    const [
      overallMetrics,
      trendAnalysis,
      categoryAnalysis,
      performanceInsights,
      userEngagement,
      contentAnalysis,
      systemMetrics,
    ] = await Promise.all([
      getOverallMetrics(currentPeriod, comparisonPeriod),
      getTrendAnalysis(currentPeriod),
      getCategoryAnalysis(currentPeriod),
      getPerformanceInsights(currentPeriod),
      getUserEngagement(currentPeriod),
      getContentAnalysis(currentPeriod),
      getSystemMetrics(currentPeriod),
    ]);

    // Prepare comprehensive analytics response
    const analyticsData = {
      overview: overallMetrics,
      trends: trendAnalysis,
      categories: categoryAnalysis,
      performance: performanceInsights,
      engagement: userEngagement,
      content: contentAnalysis,
      system: systemMetrics,
      metadata: {
        timeRange,
        currentPeriod,
        comparisonPeriod: compareWith !== "none" ? comparisonPeriod : null,
        generatedAt: new Date(),
        includeForecasts: includeForecasts === "true",
      },
    };

    // Add forecasting if requested
    if (includeForecasts === "true") {
      analyticsData.forecasts = await generateForecasts(trendAnalysis);
    }

    // Cache the analytics data
    try {
      await dashboardService.setAnalyticsAggregation(
        "dashboard",
        timeRange,
        analyticsData,
        15 * 60 // 15 minutes
      );
    } catch (cacheError) {
      console.error("Failed to cache dashboard analytics:", cacheError);
    }

    // Send response
    res.status(200).json({
      status: "success",
      fromCache: false,
      data: analyticsData,
    });
  } catch (dbError) {
    console.error("Database error in getDashboardAnalytics:", dbError);
    return next(new AppError("Failed to fetch dashboard analytics", 500));
  }
});

/**
 * Parse analytics time range
 */
const parseAnalyticsTimeRange = (timeRange, compareWith) => {
  const now = new Date();
  let currentStart, currentEnd, comparisonStart, comparisonEnd;

  // Define current period
  switch (timeRange) {
    case "7d":
      currentStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
      currentEnd = now;
      break;
    case "30d":
      currentStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
      currentEnd = now;
      break;
    case "90d":
      currentStart = new Date(now - 90 * 24 * 60 * 60 * 1000);
      currentEnd = now;
      break;
    case "1y":
      currentStart = new Date(now - 365 * 24 * 60 * 60 * 1000);
      currentEnd = now;
      break;
    default:
      currentStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
      currentEnd = now;
  }

  // Define comparison period
  if (compareWith === "previous") {
    const periodLength = currentEnd - currentStart;
    comparisonEnd = currentStart;
    comparisonStart = new Date(comparisonEnd - periodLength);
  } else if (compareWith === "year") {
    comparisonStart = new Date(currentStart);
    comparisonStart.setFullYear(comparisonStart.getFullYear() - 1);
    comparisonEnd = new Date(currentEnd);
    comparisonEnd.setFullYear(comparisonEnd.getFullYear() - 1);
  }

  return {
    currentPeriod: { start: currentStart, end: currentEnd },
    comparisonPeriod:
      compareWith !== "none"
        ? { start: comparisonStart, end: comparisonEnd }
        : null,
  };
};

/**
 * Get overall metrics with comparisons
 */
const getOverallMetrics = async (currentPeriod, comparisonPeriod) => {
  try {
    // Current period metrics
    const [
      currentExams,
      currentStudents,
      currentAttempts,
      currentQuestions,
      currentCompletions,
      currentPasses,
    ] = await Promise.all([
      Exam.countDocuments({
        isActive: true,
        createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
      }),
      User.countDocuments({
        role: "Student",
        createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
      }),
      ExamAttempt.countDocuments({
        createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
      }),
      Question.countDocuments({
        isActive: true,
        createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
      }),
      ExamAttempt.countDocuments({
        status: "completed",
        endTime: { $gte: currentPeriod.start, $lte: currentPeriod.end },
      }),
      ExamAttempt.countDocuments({
        status: "completed",
        hasPassed: true,
        endTime: { $gte: currentPeriod.start, $lte: currentPeriod.end },
      }),
    ]);

    let comparison = null;
    if (comparisonPeriod) {
      // Comparison period metrics
      const [
        prevExams,
        prevStudents,
        prevAttempts,
        prevQuestions,
        prevCompletions,
        prevPasses,
      ] = await Promise.all([
        Exam.countDocuments({
          isActive: true,
          createdAt: {
            $gte: comparisonPeriod.start,
            $lte: comparisonPeriod.end,
          },
        }),
        User.countDocuments({
          role: "Student",
          createdAt: {
            $gte: comparisonPeriod.start,
            $lte: comparisonPeriod.end,
          },
        }),
        ExamAttempt.countDocuments({
          createdAt: {
            $gte: comparisonPeriod.start,
            $lte: comparisonPeriod.end,
          },
        }),
        Question.countDocuments({
          isActive: true,
          createdAt: {
            $gte: comparisonPeriod.start,
            $lte: comparisonPeriod.end,
          },
        }),
        ExamAttempt.countDocuments({
          status: "completed",
          endTime: { $gte: comparisonPeriod.start, $lte: comparisonPeriod.end },
        }),
        ExamAttempt.countDocuments({
          status: "completed",
          hasPassed: true,
          endTime: { $gte: comparisonPeriod.start, $lte: comparisonPeriod.end },
        }),
      ]);

      comparison = {
        exams: calculatePercentageChange(currentExams, prevExams),
        students: calculatePercentageChange(currentStudents, prevStudents),
        attempts: calculatePercentageChange(currentAttempts, prevAttempts),
        questions: calculatePercentageChange(currentQuestions, prevQuestions),
        completions: calculatePercentageChange(
          currentCompletions,
          prevCompletions
        ),
        passRate: calculatePercentageChange(
          currentCompletions > 0
            ? (currentPasses / currentCompletions) * 100
            : 0,
          prevCompletions > 0 ? (prevPasses / prevCompletions) * 100 : 0
        ),
      };
    }

    const currentPassRate =
      currentCompletions > 0 ? (currentPasses / currentCompletions) * 100 : 0;

    return {
      current: {
        exams: currentExams,
        students: currentStudents,
        attempts: currentAttempts,
        questions: currentQuestions,
        completions: currentCompletions,
        passes: currentPasses,
        passRate: Math.round(currentPassRate * 100) / 100,
      },
      comparison,
    };
  } catch (error) {
    console.error("Error getting overall metrics:", error);
    return {
      current: {
        exams: 0,
        students: 0,
        attempts: 0,
        questions: 0,
        completions: 0,
        passes: 0,
        passRate: 0,
      },
      comparison: null,
    };
  }
};

/**
 * Get trend analysis
 */
const getTrendAnalysis = async (currentPeriod) => {
  try {
    const dailyTrends = await ExamAttempt.aggregate([
      {
        $match: {
          createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
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
          uniqueUsers: { $addToSet: "$userId" },
        },
      },
      {
        $addFields: {
          date: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
            },
          },
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
          uniqueUserCount: { $size: "$uniqueUsers" },
        },
      },
      { $sort: { date: 1 } },
    ]);

    // Calculate moving averages
    const movingAverages = calculateMovingAverages(dailyTrends, 7); // 7-day moving average

    return {
      daily: dailyTrends.map((trend) => ({
        date: trend.date,
        totalAttempts: trend.totalAttempts,
        completedAttempts: trend.completedAttempts,
        passedAttempts: trend.passedAttempts,
        passRate: Math.round(trend.passRate * 100) / 100,
        uniqueUsers: trend.uniqueUserCount,
      })),
      movingAverages,
    };
  } catch (error) {
    console.error("Error getting trend analysis:", error);
    return { daily: [], movingAverages: [] };
  }
};

/**
 * Get category analysis
 */
const getCategoryAnalysis = async (currentPeriod) => {
  try {
    const categoryStats = await ExamAttempt.aggregate([
      {
        $match: {
          createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
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
          _id: "$exam.category",
          totalAttempts: { $sum: 1 },
          passedAttempts: {
            $sum: { $cond: [{ $eq: ["$hasPassed", true] }, 1, 0] },
          },
          averageScore: { $avg: "$finalScore" },
          averageDuration: { $avg: "$responseTime" },
          uniqueExams: { $addToSet: "$examId" },
          totalScore: { $sum: "$finalScore" },
          totalPossibleScore: { $sum: "$exam.totalMarks" },
        },
      },
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
              {
                $divide: [
                  "$averageScore",
                  { $divide: ["$totalPossibleScore", "$totalAttempts"] },
                ],
              },
              100,
            ],
          },
          examCount: { $size: "$uniqueExams" },
        },
      },
      { $sort: { totalAttempts: -1 } },
    ]);

    return categoryStats.map((stat) => ({
      category: stat._id,
      totalAttempts: stat.totalAttempts,
      passedAttempts: stat.passedAttempts,
      passRate: Math.round(stat.passRate * 100) / 100,
      averageScore: Math.round(stat.averageScore * 100) / 100,
      averageScorePercentage:
        Math.round(stat.averageScorePercentage * 100) / 100,
      averageDuration: Math.round(stat.averageDuration / 60), // Convert to minutes
      examCount: stat.examCount,
    }));
  } catch (error) {
    console.error("Error getting category analysis:", error);
    return [];
  }
};

/**
 * Get performance insights
 */
const getPerformanceInsights = async (currentPeriod) => {
  try {
    const [topPerformers, underPerformers, difficultyAnalysis] =
      await Promise.all([
        // Top performing exams
        ExamAttempt.aggregate([
          {
            $match: {
              createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
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
            },
          },
          {
            $match: { totalAttempts: { $gte: 5 } }, // At least 5 attempts
          },
          {
            $addFields: {
              passRate: {
                $multiply: [
                  { $divide: ["$passedAttempts", "$totalAttempts"] },
                  100,
                ],
              },
            },
          },
          { $sort: { passRate: -1, averageScore: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "exams",
              localField: "_id",
              foreignField: "_id",
              as: "exam",
            },
          },
          { $unwind: "$exam" },
        ]),

        // Under-performing exams
        ExamAttempt.aggregate([
          {
            $match: {
              createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
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
            },
          },
          {
            $match: { totalAttempts: { $gte: 5 } }, // At least 5 attempts
          },
          {
            $addFields: {
              passRate: {
                $multiply: [
                  { $divide: ["$passedAttempts", "$totalAttempts"] },
                  100,
                ],
              },
            },
          },
          { $sort: { passRate: 1, averageScore: 1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "exams",
              localField: "_id",
              foreignField: "_id",
              as: "exam",
            },
          },
          { $unwind: "$exam" },
        ]),

        // Difficulty level analysis
        ExamAttempt.aggregate([
          {
            $match: {
              createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
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
              _id: "$exam.difficultyLevel",
              totalAttempts: { $sum: 1 },
              passedAttempts: {
                $sum: { $cond: [{ $eq: ["$hasPassed", true] }, 1, 0] },
              },
              averageScore: { $avg: "$finalScore" },
            },
          },
          {
            $addFields: {
              passRate: {
                $multiply: [
                  { $divide: ["$passedAttempts", "$totalAttempts"] },
                  100,
                ],
              },
            },
          },
        ]),
      ]);

    return {
      topPerformers: topPerformers.map((exam) => ({
        examId: exam._id,
        title: exam.exam.title,
        category: exam.exam.category,
        totalAttempts: exam.totalAttempts,
        passRate: Math.round(exam.passRate * 100) / 100,
        averageScore: Math.round(exam.averageScore * 100) / 100,
      })),
      underPerformers: underPerformers.map((exam) => ({
        examId: exam._id,
        title: exam.exam.title,
        category: exam.exam.category,
        totalAttempts: exam.totalAttempts,
        passRate: Math.round(exam.passRate * 100) / 100,
        averageScore: Math.round(exam.averageScore * 100) / 100,
      })),
      difficultyAnalysis: difficultyAnalysis.map((level) => ({
        difficulty: level._id,
        totalAttempts: level.totalAttempts,
        passedAttempts: level.passedAttempts,
        passRate: Math.round(level.passRate * 100) / 100,
        averageScore: Math.round(level.averageScore * 100) / 100,
      })),
    };
  } catch (error) {
    console.error("Error getting performance insights:", error);
    return {
      topPerformers: [],
      underPerformers: [],
      difficultyAnalysis: [],
    };
  }
};

/**
 * Get user engagement metrics
 */
const getUserEngagement = async (currentPeriod) => {
  try {
    const [engagementStats, retentionAnalysis] = await Promise.all([
      User.aggregate([
        {
          $match: {
            role: "Student",
            createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
          },
        },
        {
          $lookup: {
            from: "examattempts",
            localField: "_id",
            foreignField: "userId",
            as: "attempts",
          },
        },
        {
          $addFields: {
            attemptCount: { $size: "$attempts" },
            hasAttempted: { $gt: [{ $size: "$attempts" }, 0] },
          },
        },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: 1 },
            activeStudents: { $sum: { $cond: ["$hasAttempted", 1, 0] } },
            averageAttempts: { $avg: "$attemptCount" },
          },
        },
      ]),

      // Retention analysis (students who took multiple exams)
      ExamAttempt.aggregate([
        {
          $match: {
            createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
          },
        },
        {
          $group: {
            _id: "$userId",
            totalAttempts: { $sum: 1 },
            uniqueExams: { $addToSet: "$examId" },
            firstAttempt: { $min: "$createdAt" },
            lastAttempt: { $max: "$createdAt" },
          },
        },
        {
          $addFields: {
            isRetained: { $gt: ["$totalAttempts", 1] },
            examVariety: { $size: "$uniqueExams" },
          },
        },
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            retainedUsers: { $sum: { $cond: ["$isRetained", 1, 0] } },
            averageExamVariety: { $avg: "$examVariety" },
          },
        },
      ]),
    ]);

    const engagement =
      engagementStats.length > 0
        ? engagementStats[0]
        : {
            totalStudents: 0,
            activeStudents: 0,
            averageAttempts: 0,
          };

    const retention =
      retentionAnalysis.length > 0
        ? retentionAnalysis[0]
        : {
            totalUsers: 0,
            retainedUsers: 0,
            averageExamVariety: 0,
          };

    return {
      totalStudents: engagement.totalStudents,
      activeStudents: engagement.activeStudents,
      engagementRate:
        engagement.totalStudents > 0
          ? Math.round(
              (engagement.activeStudents / engagement.totalStudents) * 100 * 100
            ) / 100
          : 0,
      averageAttempts: Math.round(engagement.averageAttempts * 100) / 100,
      retentionRate:
        retention.totalUsers > 0
          ? Math.round(
              (retention.retainedUsers / retention.totalUsers) * 100 * 100
            ) / 100
          : 0,
      averageExamVariety: Math.round(retention.averageExamVariety * 100) / 100,
    };
  } catch (error) {
    console.error("Error getting user engagement:", error);
    return {
      totalStudents: 0,
      activeStudents: 0,
      engagementRate: 0,
      averageAttempts: 0,
      retentionRate: 0,
      averageExamVariety: 0,
    };
  }
};

/**
 * Get content analysis
 */
const getContentAnalysis = async (currentPeriod) => {
  try {
    const [examStats, questionStats] = await Promise.all([
      Exam.aggregate([
        {
          $match: {
            isActive: true,
            createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
          },
        },
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            averageQuestions: { $avg: "$totalQuestions" },
            averageMarks: { $avg: "$totalMarks" },
            averageDuration: { $avg: "$duration" },
            premiumCount: {
              $sum: { $cond: [{ $eq: ["$isPremium", true] }, 1, 0] },
            },
          },
        },
      ]),

      Question.aggregate([
        {
          $match: {
            isActive: true,
            createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
          },
        },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            averageMarks: { $avg: "$marks" },
          },
        },
      ]),
    ]);

    return {
      examsByCategory: examStats.map((stat) => ({
        category: stat._id,
        count: stat.count,
        averageQuestions: Math.round(stat.averageQuestions),
        averageMarks: Math.round(stat.averageMarks),
        averageDuration: Math.round(stat.averageDuration),
        premiumPercentage: Math.round((stat.premiumCount / stat.count) * 100),
      })),
      questionsByType: questionStats.map((stat) => ({
        type: stat._id,
        count: stat.count,
        averageMarks: Math.round(stat.averageMarks * 100) / 100,
      })),
    };
  } catch (error) {
    console.error("Error getting content analysis:", error);
    return {
      examsByCategory: [],
      questionsByType: [],
    };
  }
};

/**
 * Get system metrics
 */
const getSystemMetrics = async (currentPeriod) => {
  try {
    // System performance metrics
    const systemLoad = {
      examCreationRate: 0,
      questionCreationRate: 0,
      userRegistrationRate: 0,
      attemptCompletionRate: 0,
    };

    const periodDays = Math.ceil(
      (currentPeriod.end - currentPeriod.start) / (24 * 60 * 60 * 1000)
    );

    // Calculate rates per day
    const [examCount, questionCount, userCount, attemptCount] =
      await Promise.all([
        Exam.countDocuments({
          createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
        }),
        Question.countDocuments({
          createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
        }),
        User.countDocuments({
          role: "Student",
          createdAt: { $gte: currentPeriod.start, $lte: currentPeriod.end },
        }),
        ExamAttempt.countDocuments({
          status: "completed",
          endTime: { $gte: currentPeriod.start, $lte: currentPeriod.end },
        }),
      ]);

    systemLoad.examCreationRate =
      Math.round((examCount / periodDays) * 100) / 100;
    systemLoad.questionCreationRate =
      Math.round((questionCount / periodDays) * 100) / 100;
    systemLoad.userRegistrationRate =
      Math.round((userCount / periodDays) * 100) / 100;
    systemLoad.attemptCompletionRate =
      Math.round((attemptCount / periodDays) * 100) / 100;

    return {
      systemLoad,
      healthStatus: "optimal", // This could be calculated based on actual system metrics
      uptime: Math.round(process.uptime() / 3600), // Hours
      memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
    };
  } catch (error) {
    console.error("Error getting system metrics:", error);
    return {
      systemLoad: {
        examCreationRate: 0,
        questionCreationRate: 0,
        userRegistrationRate: 0,
        attemptCompletionRate: 0,
      },
      healthStatus: "unknown",
      uptime: 0,
      memoryUsage: 0,
    };
  }
};

/**
 * Generate forecasts based on trend analysis
 */
const generateForecasts = async (trendAnalysis) => {
  try {
    // Simple linear regression for forecasting
    const { daily } = trendAnalysis;

    if (daily.length < 7) {
      return { message: "Insufficient data for forecasting" };
    }

    // Calculate simple trends for next 7 days
    const lastWeek = daily.slice(-7);
    const avgDailyAttempts =
      lastWeek.reduce((sum, day) => sum + day.totalAttempts, 0) / 7;
    const avgPassRate =
      lastWeek.reduce((sum, day) => sum + day.passRate, 0) / 7;

    return {
      nextWeekPrediction: {
        expectedAttempts: Math.round(avgDailyAttempts * 7),
        expectedPassRate: Math.round(avgPassRate * 100) / 100,
        confidence: "medium", // This could be calculated based on variance
      },
      trends: {
        attempts:
          avgDailyAttempts > (daily[0]?.totalAttempts || 0)
            ? "increasing"
            : "decreasing",
        passRate:
          avgPassRate > (daily[0]?.passRate || 0) ? "improving" : "declining",
      },
    };
  } catch (error) {
    console.error("Error generating forecasts:", error);
    return { message: "Unable to generate forecasts" };
  }
};

/**
 * Helper functions
 */
const calculatePercentageChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 100) / 100;
};

const calculateMovingAverages = (data, windowSize) => {
  const movingAvgs = [];

  for (let i = windowSize - 1; i < data.length; i++) {
    const window = data.slice(i - windowSize + 1, i + 1);
    const avgAttempts =
      window.reduce((sum, item) => sum + item.totalAttempts, 0) / windowSize;
    const avgPassRate =
      window.reduce((sum, item) => sum + item.passRate, 0) / windowSize;

    movingAvgs.push({
      date: data[i].date,
      avgAttempts: Math.round(avgAttempts * 100) / 100,
      avgPassRate: Math.round(avgPassRate * 100) / 100,
    });
  }

  return movingAvgs;
};

export default getDashboardAnalytics;
