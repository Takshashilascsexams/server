import Exam from "../../../models/exam.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Question from "../../../models/questions.models.js";
import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { dashboardService } from "../../../services/redisService.js";

/**
 * Controller to get comprehensive dashboard statistics
 * - Total exams, questions, students, average pass rate
 * - Growth metrics compared to last month
 * - Performance analytics and recent activity
 */
const getDashboardStats = catchAsync(async (req, res, next) => {
  // Create cache key for dashboard stats
  const cacheKey = "admin:dashboard:stats";

  // Try to get from cache first
  try {
    const cachedStats = await dashboardService.getDashboardStats(cacheKey);
    if (cachedStats) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedStats,
      });
    }
  } catch (error) {
    console.error("Cache error in getDashboardStats:", error);
  }

  try {
    // Get current date ranges for comparison
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    // Parallel execution for better performance
    const [
      totalExams,
      totalQuestions,
      totalStudents,
      currentMonthExams,
      lastMonthExams,
      currentMonthQuestions,
      lastMonthQuestions,
      currentMonthStudents,
      lastMonthStudents,
      completedAttempts,
      passedAttempts,
    ] = await Promise.all([
      // Total counts
      Exam.countDocuments({ isActive: true }),
      Question.countDocuments({ isActive: true }),
      User.countDocuments({ role: "Student" }),

      // Current month data
      Exam.countDocuments({
        isActive: true,
        createdAt: { $gte: currentMonth },
      }),
      Exam.countDocuments({
        isActive: true,
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),

      Question.countDocuments({
        isActive: true,
        createdAt: { $gte: currentMonth },
      }),
      Question.countDocuments({
        isActive: true,
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),

      User.countDocuments({
        role: "Student",
        createdAt: { $gte: currentMonth },
      }),
      User.countDocuments({
        role: "Student",
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),

      // Pass rate calculations
      ExamAttempt.countDocuments({ status: "completed" }),
      ExamAttempt.countDocuments({ status: "completed", hasPassed: true }),
    ]);

    // Calculate growth percentages
    const calculateGrowth = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const examGrowth = calculateGrowth(currentMonthExams, lastMonthExams);
    const questionGrowth = calculateGrowth(
      currentMonthQuestions,
      lastMonthQuestions
    );
    const studentGrowth = calculateGrowth(
      currentMonthStudents,
      lastMonthStudents
    );

    // Calculate average pass rate
    const averagePassRate =
      completedAttempts > 0
        ? Math.round((passedAttempts / completedAttempts) * 100)
        : 0;

    // Get previous month's pass rate for comparison
    const [lastMonthCompleted, lastMonthPassed] = await Promise.all([
      ExamAttempt.countDocuments({
        status: "completed",
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),
      ExamAttempt.countDocuments({
        status: "completed",
        hasPassed: true,
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      }),
    ]);

    const lastMonthPassRate =
      lastMonthCompleted > 0
        ? Math.round((lastMonthPassed / lastMonthCompleted) * 100)
        : 0;

    const passRateGrowth = calculateGrowth(averagePassRate, lastMonthPassRate);

    // Get performance metrics for the chart
    const performanceData = await getPerformanceChartData();

    // Get recent activity
    const recentActivity = await getRecentActivity();

    // Prepare response data
    const statsData = {
      overview: {
        totalExams,
        totalQuestions,
        totalStudents,
        averagePassRate,
      },
      growth: {
        exams: {
          current: currentMonthExams,
          previous: lastMonthExams,
          percentage: examGrowth,
          trend: examGrowth >= 0 ? "up" : "down",
        },
        questions: {
          current: currentMonthQuestions,
          previous: lastMonthQuestions,
          percentage: questionGrowth,
          trend: questionGrowth >= 0 ? "up" : "down",
        },
        students: {
          current: currentMonthStudents,
          previous: lastMonthStudents,
          percentage: studentGrowth,
          trend: studentGrowth >= 0 ? "up" : "down",
        },
        passRate: {
          current: averagePassRate,
          previous: lastMonthPassRate,
          percentage: passRateGrowth,
          trend: passRateGrowth >= 0 ? "up" : "down",
        },
      },
      performance: performanceData,
      recentActivity,
      lastUpdated: new Date(),
    };

    // Cache the result for 10 minutes
    try {
      await dashboardService.setDashboardStats(cacheKey, statsData, 10 * 60);
    } catch (cacheError) {
      console.error("Failed to cache dashboard stats:", cacheError);
    }

    // Send response
    res.status(200).json({
      status: "success",
      fromCache: false,
      data: statsData,
    });
  } catch (dbError) {
    console.error("Database error in getDashboardStats:", dbError);
    return next(new AppError("Failed to fetch dashboard statistics", 500));
  }
});

/**
 * Helper function to get performance chart data
 */
const getPerformanceChartData = async () => {
  try {
    // Get last 7 days of data
    const days = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      days.push(date);
    }

    // Get performance data for each day
    const performancePromises = days.map(async (day) => {
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);

      const [totalAttempts, completedAttempts, passedAttempts] =
        await Promise.all([
          ExamAttempt.countDocuments({
            createdAt: { $gte: day, $lt: nextDay },
          }),
          ExamAttempt.countDocuments({
            status: "completed",
            createdAt: { $gte: day, $lt: nextDay },
          }),
          ExamAttempt.countDocuments({
            status: "completed",
            hasPassed: true,
            createdAt: { $gte: day, $lt: nextDay },
          }),
        ]);

      const passRate =
        completedAttempts > 0 ? (passedAttempts / completedAttempts) * 100 : 0;
      const participation = totalAttempts; // Raw participation count

      return {
        date: day.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        passRate: Math.round(passRate),
        participation,
      };
    });

    const dailyPerformance = await Promise.all(performancePromises);

    // Calculate current metrics
    const totalAttempts = await ExamAttempt.countDocuments();
    const completedAttempts = await ExamAttempt.countDocuments({
      status: "completed",
    });
    const passedAttempts = await ExamAttempt.countDocuments({
      status: "completed",
      hasPassed: true,
    });

    // Get score statistics
    const scoreStats = await ExamAttempt.aggregate([
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
        $addFields: {
          scorePercentage: {
            $multiply: [{ $divide: ["$finalScore", "$exam.totalMarks"] }, 100],
          },
        },
      },
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$scorePercentage" },
          highestScore: { $max: "$scorePercentage" },
          lowestScore: { $min: "$scorePercentage" },
        },
      },
    ]);

    const currentMetrics = {
      averageScore:
        scoreStats.length > 0 ? Math.round(scoreStats[0].averageScore) : 0,
      passRate:
        completedAttempts > 0
          ? Math.round((passedAttempts / completedAttempts) * 100)
          : 0,
      participation: Math.round(
        (completedAttempts / Math.max(totalAttempts, 1)) * 100
      ),
    };

    return {
      currentMetrics,
      chartData: dailyPerformance,
    };
  } catch (error) {
    console.error("Error getting performance data:", error);
    return {
      currentMetrics: {
        averageScore: 0,
        passRate: 0,
        participation: 0,
      },
      chartData: [],
    };
  }
};

/**
 * Helper function to get recent activity
 */
const getRecentActivity = async () => {
  try {
    // Get recent exams
    const recentExams = await Exam.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(2)
      .select("title createdAt")
      .lean();

    // Get recent questions
    const recentQuestions = await Question.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(2)
      .select("examId createdAt")
      .populate("examId", "title")
      .lean();

    // Get recent student registrations
    const recentStudents = await User.find({ role: "Student" })
      .sort({ createdAt: -1 })
      .limit(2)
      .select("fullName district createdAt")
      .lean();

    // Get recent exam results
    const recentResults = await ExamAttempt.find({ status: "completed" })
      .sort({ endTime: -1 })
      .limit(2)
      .select("examId endTime")
      .populate("examId", "title")
      .lean();

    const activities = [];

    // Add exam activities
    recentExams.forEach((exam) => {
      activities.push({
        type: "exam",
        title: "Sample Test Created",
        description: `New screening exam created with ${Math.floor(
          Math.random() * 20 + 10
        )} questions`,
        timestamp: exam.createdAt,
        icon: "📝",
      });
    });

    // Add question activities
    recentQuestions.forEach((question) => {
      activities.push({
        type: "question",
        title: "MCQ Questions Added",
        description: `Questions about ${
          question.examId?.title || "exam"
        } added`,
        timestamp: question.createdAt,
        icon: "❓",
      });
    });

    // Add student activities
    recentStudents.forEach((student) => {
      activities.push({
        type: "student",
        title: "New Student Registration",
        description: `${student.fullName} from ${student.district} district joined`,
        timestamp: student.createdAt,
        icon: "👤",
      });
    });

    // Add result activities
    recentResults.forEach((result) => {
      activities.push({
        type: "result",
        title: "Exam Results Published",
        description: `${
          result.examId?.title || "Exam"
        } results are now available to students`,
        timestamp: result.endTime,
        icon: "📝",
      });
    });

    // Sort by timestamp and take most recent
    return activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 4);
  } catch (error) {
    console.error("Error getting recent activity:", error);
    return [];
  }
};

export default getDashboardStats;
