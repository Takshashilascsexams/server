import Exam from "../../../models/exam.models.js";
import Question from "../../../models/questions.models.js";
import User from "../../../models/user.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { dashboardService } from "../../../services/redisService.js";
import { formatDashboardDate } from "../../../lib/formatDashboardDates.js";
import { Types } from "mongoose";

/**
 * Controller to get recent activity for dashboard
 * - Recent exam creations
 * - Recent student registrations
 * - Recent question additions
 * - Recent exam completions
 */
const getRecentActivity = catchAsync(async (req, res, next) => {
  const { limit = 10, type = "all" } = req.query;
  const cacheKey = `recent:activity:${limit}:${type}`;

  // Try to get from cache first
  try {
    const cachedActivity = await dashboardService.getRecentActivity();
    if (cachedActivity) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: { activities: cachedActivity },
      });
    }
  } catch (error) {
    console.error("Cache error in getRecentActivity:", error);
  }

  try {
    const activities = [];
    const activityLimit = Math.min(parseInt(limit), 50); // Max 50 activities

    // Get recent activities based on type filter
    if (type === "all" || type === "exams") {
      const recentExams = await getRecentExamActivity(activityLimit);
      activities.push(...recentExams);
    }

    if (type === "all" || type === "students") {
      const recentStudents = await getRecentStudentActivity(activityLimit);
      activities.push(...recentStudents);
    }

    if (type === "all" || type === "questions") {
      const recentQuestions = await getRecentQuestionActivity(activityLimit);
      activities.push(...recentQuestions);
    }

    if (type === "all" || type === "results") {
      const recentResults = await getRecentResultActivity(activityLimit);
      activities.push(...recentResults);
    }

    // Sort all activities by timestamp (most recent first)
    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, activityLimit);

    // Format timestamps for display
    const formattedActivities = sortedActivities.map((activity) => ({
      ...activity,
      timeAgo: formatDashboardDate(activity.timestamp),
      formattedDate: new Date(activity.timestamp).toLocaleString(),
    }));

    // Cache the result for 3 minutes
    try {
      await dashboardService.setRecentActivity(formattedActivities, 3 * 60);
    } catch (cacheError) {
      console.error("Failed to cache recent activity:", cacheError);
    }

    // Send response
    res.status(200).json({
      status: "success",
      fromCache: false,
      data: {
        activities: formattedActivities,
        totalCount: formattedActivities.length,
        lastUpdated: new Date(),
      },
    });
  } catch (dbError) {
    console.error("Database error in getRecentActivity:", dbError);
    return next(new AppError("Failed to fetch recent activity", 500));
  }
});

/**
 * Get recent exam creation activity
 */
const getRecentExamActivity = async (limit) => {
  try {
    const recentExams = await Exam.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit * 0.4)) // 40% of total limit
      .select("title description totalQuestions createdAt category isPremium")
      .populate("createdBy", "fullName")
      .lean();

    return recentExams.map((exam) => ({
      id: exam._id,
      type: "exam",
      title: "Sample Test Created",
      description: `New ${exam.category
        .toLowerCase()
        .replace("_", " ")} exam "${exam.title}" created with ${
        exam.totalQuestions
      } questions`,
      details: {
        examTitle: exam.title,
        category: exam.category,
        totalQuestions: exam.totalQuestions,
        isPremium: exam.isPremium,
        creator: exam.createdBy?.fullName || "Admin",
      },
      timestamp: exam.createdAt,
      icon: "📝",
      color: "bg-blue-100 text-blue-700",
      priority: exam.isPremium ? "high" : "normal",
    }));
  } catch (error) {
    console.error("Error getting recent exam activity:", error);
    return [];
  }
};

/**
 * Get recent student registration activity
 */
const getRecentStudentActivity = async (limit) => {
  try {
    const recentStudents = await User.find({ role: "Student" })
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit * 0.3)) // 30% of total limit
      .select("fullName district createdAt email")
      .lean();

    return recentStudents.map((student) => ({
      id: student._id,
      type: "student",
      title: "New Student Registration",
      description: `${student.fullName} from ${student.district} district joined the portal`,
      details: {
        studentName: student.fullName,
        district: student.district,
        email: student.email,
      },
      timestamp: student.createdAt,
      icon: "👤",
      color: "bg-green-100 text-green-700",
      priority: "normal",
    }));
  } catch (error) {
    console.error("Error getting recent student activity:", error);
    return [];
  }
};

/**
 * Get recent question addition activity
 */
const getRecentQuestionActivity = async (limit) => {
  try {
    const recentQuestions = await Question.aggregate([
      { $match: { isActive: true } },
      { $sort: { createdAt: -1 } },
      { $limit: Math.ceil(limit * 0.2) }, // 20% of total limit
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
          _id: {
            examId: "$examId",
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
              },
            },
          },
          count: { $sum: 1 },
          examTitle: { $first: "$exam.title" },
          examCategory: { $first: "$exam.category" },
          latestCreation: { $max: "$createdAt" },
          questionTypes: { $addToSet: "$type" },
          subjects: { $addToSet: "$subject" },
        },
      },
      { $sort: { latestCreation: -1 } },
    ]);

    return recentQuestions.map((group) => ({
      id: `question_${group._id.examId}_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      type: "question",
      title: "MCQ Questions Added",
      description: `${group.count} questions added to "${
        group.examTitle
      }" covering ${
        group.subjects.filter((s) => s).join(", ") || "various topics"
      }`,
      details: {
        examTitle: group.examTitle,
        category: group.examCategory,
        questionCount: group.count,
        questionTypes: group.questionTypes,
        subjects: group.subjects.filter((s) => s),
      },
      timestamp: group.latestCreation,
      icon: "❓",
      color: "bg-pink-100 text-pink-700",
      priority: group.count > 10 ? "high" : "normal",
    }));
  } catch (error) {
    console.error("Error getting recent question activity:", error);
    return [];
  }
};

/**
 * Get recent exam result activity
 */
const getRecentResultActivity = async (limit) => {
  try {
    const recentResults = await ExamAttempt.aggregate([
      {
        $match: {
          status: "completed",
          endTime: { $exists: true },
        },
      },
      { $sort: { endTime: -1 } },
      { $limit: Math.ceil(limit * 0.1) }, // 10% of total limit
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
          _id: {
            examId: "$examId",
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$endTime",
              },
            },
          },
          examTitle: { $first: "$exam.title" },
          examCategory: { $first: "$exam.category" },
          totalAttempts: { $sum: 1 },
          passedAttempts: {
            $sum: { $cond: [{ $eq: ["$hasPassed", true] }, 1, 0] },
          },
          latestCompletion: { $max: "$endTime" },
          averageScore: { $avg: "$finalScore" },
          totalMarks: { $first: "$exam.totalMarks" },
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
          averagePercentage: {
            $multiply: [{ $divide: ["$averageScore", "$totalMarks"] }, 100],
          },
        },
      },
      { $sort: { latestCompletion: -1 } },
    ]);

    return recentResults.map((result) => ({
      id: `result_${result._id.examId}_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      type: "result",
      title: "Exam Results Published",
      description: `${result.examTitle} results: ${
        result.totalAttempts
      } attempts, ${Math.round(result.passRate)}% pass rate`,
      details: {
        examTitle: result.examTitle,
        category: result.examCategory,
        totalAttempts: result.totalAttempts,
        passedAttempts: result.passedAttempts,
        passRate: Math.round(result.passRate * 100) / 100,
        averageScore: Math.round(result.averagePercentage * 100) / 100,
      },
      timestamp: result.latestCompletion,
      icon: "📊",
      color: "bg-amber-100 text-amber-700",
      priority: result.totalAttempts > 50 ? "high" : "normal",
    }));
  } catch (error) {
    console.error("Error getting recent result activity:", error);
    return [];
  }
};

export default getRecentActivity;
