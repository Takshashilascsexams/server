import Exam from "../../../models/exam.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Question from "../../../models/questions.models.js";
import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { dashboardService } from "../../../services/redisService.js";

/**
 * Controller to get dashboard overview with comprehensive statistics
 * - Provides high-level metrics for the main dashboard view
 * - Includes growth trends and performance indicators
 */
const getDashboardOverview = catchAsync(async (req, res, next) => {
  const cacheKey = "admin:dashboard:overview";

  // Try to get from cache first
  try {
    const cachedOverview = await dashboardService.getOverviewStats();
    if (cachedOverview) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedOverview,
      });
    }
  } catch (error) {
    console.error("Cache error in getDashboardOverview:", error);
  }

  try {
    // Get date ranges for trend analysis
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const currentWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Parallel execution for better performance
    const [
      // Total counts
      totalActiveExams,
      totalActiveQuestions,
      totalStudents,
      totalAttempts,

      // Current period counts
      newExamsThisMonth,
      newQuestionsThisMonth,
      newStudentsThisMonth,
      attemptsThisWeek,

      // Previous period counts for comparison
      examsLastMonth,
      questionsLastMonth,
      studentsLastMonth,
      attemptsLastWeek,

      // Performance metrics
      completedAttempts,
      passedAttempts,
      averageScoreData,
    ] = await Promise.all([
      // Total active counts
      Exam.countDocuments({ isActive: true }),
      Question.countDocuments({ isActive: true }),
      User.countDocuments({ role: "Student" }),
      ExamAttempt.countDocuments(),

      // Current month data
      Exam.countDocuments({
        isActive: true,
        createdAt: { $gte: currentMonth },
      }),
      Question.countDocuments({
        isActive: true,
        createdAt: { $gte: currentMonth },
      }),
      User.countDocuments({
        role: "Student",
        createdAt: { $gte: currentMonth },
      }),
      ExamAttempt.countDocuments({
        createdAt: { $gte: currentWeek },
      }),

      // Previous period data
      Exam.countDocuments({
        isActive: true,
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),
      Question.countDocuments({
        isActive: true,
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),
      User.countDocuments({
        role: "Student",
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),
      ExamAttempt.countDocuments({
        createdAt: {
          $gte: new Date(now - 14 * 24 * 60 * 60 * 1000),
          $lt: currentWeek,
        },
      }),

      // Performance data
      ExamAttempt.countDocuments({ status: "completed" }),
      ExamAttempt.countDocuments({ status: "completed", hasPassed: true }),

      // Average score calculation
      ExamAttempt.aggregate([
        { $match: { status: "completed" } },
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
          },
        },
      ]),
    ]);

    // Helper function to calculate growth percentage
    const calculateGrowth = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // Calculate growth metrics
    const examGrowth = calculateGrowth(newExamsThisMonth, examsLastMonth);
    const questionGrowth = calculateGrowth(
      newQuestionsThisMonth,
      questionsLastMonth
    );
    const studentGrowth = calculateGrowth(
      newStudentsThisMonth,
      studentsLastMonth
    );
    const attemptGrowth = calculateGrowth(attemptsThisWeek, attemptsLastWeek);

    // Calculate performance metrics
    const passRate =
      completedAttempts > 0
        ? Math.round((passedAttempts / completedAttempts) * 100)
        : 0;

    const averageScore =
      averageScoreData.length > 0
        ? Math.round(averageScoreData[0].averageScore)
        : 0;

    // Get category-wise exam distribution
    const examsByCategory = await Exam.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Get top performing exams
    const topExams = await ExamAttempt.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: "$examId",
          totalAttempts: { $sum: 1 },
          averageScore: { $avg: "$finalScore" },
          passRate: {
            $avg: { $cond: [{ $eq: ["$hasPassed", true] }, 1, 0] },
          },
        },
      },
      { $match: { totalAttempts: { $gte: 5 } } }, // Only exams with 5+ attempts
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
      {
        $project: {
          title: "$exam.title",
          category: "$exam.category",
          totalAttempts: 1,
          averageScore: { $round: ["$averageScore", 1] },
          passRate: { $round: [{ $multiply: ["$passRate", 100] }, 1] },
        },
      },
    ]);

    // Prepare comprehensive overview data
    const overviewData = {
      // Main statistics
      statistics: {
        totalExams: totalActiveExams,
        totalQuestions: totalActiveQuestions,
        totalStudents: totalStudents,
        totalAttempts: totalAttempts,
        averagePassRate: passRate,
        averageScore: averageScore,
      },

      // Growth metrics
      growth: {
        exams: {
          current: newExamsThisMonth,
          previous: examsLastMonth,
          percentage: examGrowth,
          trend: examGrowth >= 0 ? "up" : "down",
        },
        questions: {
          current: newQuestionsThisMonth,
          previous: questionsLastMonth,
          percentage: Math.abs(questionGrowth),
          trend: questionGrowth >= 0 ? "up" : "down",
        },
        students: {
          current: newStudentsThisMonth,
          previous: studentsLastMonth,
          percentage: Math.abs(studentGrowth),
          trend: studentGrowth >= 0 ? "up" : "down",
        },
        attempts: {
          current: attemptsThisWeek,
          previous: attemptsLastWeek,
          percentage: Math.abs(attemptGrowth),
          trend: attemptGrowth >= 0 ? "up" : "down",
        },
      },

      // Category distribution
      examDistribution: examsByCategory.map((cat) => ({
        category: cat._id,
        count: cat.count,
        percentage: Math.round((cat.count / totalActiveExams) * 100),
      })),

      // Top performing exams
      topPerformingExams: topExams,

      // Activity summary
      activitySummary: {
        activeExams: totalActiveExams,
        questionsPool: totalActiveQuestions,
        registeredStudents: totalStudents,
        monthlyGrowth: {
          exams: examGrowth,
          students: studentGrowth,
        },
      },

      // System health indicators
      systemHealth: {
        examCreationRate: newExamsThisMonth,
        studentEngagement: passRate,
        contentQuality: averageScore,
        systemLoad: "normal", // This could be calculated based on actual metrics
      },

      // Timestamps
      lastUpdated: new Date(),
      dataTimestamp: now,
    };

    // Cache the overview data
    try {
      await dashboardService.setOverviewStats(overviewData, 15 * 60); // 15 minutes
    } catch (cacheError) {
      console.error("Failed to cache dashboard overview:", cacheError);
    }

    // Send response
    res.status(200).json({
      status: "success",
      fromCache: false,
      data: overviewData,
    });
  } catch (dbError) {
    console.error("Database error in getDashboardOverview:", dbError);
    return next(new AppError("Failed to fetch dashboard overview", 500));
  }
});

export default getDashboardOverview;
