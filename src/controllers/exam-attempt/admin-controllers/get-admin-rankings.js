import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";
import mongoose from "mongoose";

/**
 * Admin controller to get detailed rankings for a specific exam
 * With enhanced student information for admin panel
 */
const getAdminRankings = catchAsync(async (req, res, next) => {
  const { examId } = req.params;
  const {
    page = 1,
    limit = 20,
    sortBy = "rank",
    sortOrder = "asc",
  } = req.query;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Create cache key based on query parameters
  const cacheKey = `admin:rankings:${examId}:${page}:${limit}:${sortBy}:${sortOrder}`;

  // Try to get from cache first
  try {
    const cachedData = await examService.get(examService.examCache, cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getAdminRankings:", error);
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Build sort object
  const sort = {};
  if (sortBy === "rank") {
    sort.rank = sortOrder === "desc" ? -1 : 1;
  } else if (sortBy === "score") {
    sort.finalScore = sortOrder === "desc" ? -1 : 1;
  } else if (sortBy === "time") {
    sort.endTime = sortOrder === "desc" ? -1 : 1;
  } else {
    sort.rank = 1; // Default sort
  }

  // Calculate skip value for pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get all completed attempts for this exam with pagination
  const attempts = await ExamAttempt.find({
    examId: mongoose.Types.ObjectId(examId),
    status: "completed",
  })
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit))
    .populate({
      path: "userId",
      select: "fullName email phoneNumber",
    })
    .lean();

  // Get total count for pagination
  const total = await ExamAttempt.countDocuments({
    examId: mongoose.Types.ObjectId(examId),
    status: "completed",
  });

  // Format the rankings data for admin view
  const rankings = attempts.map((attempt) => {
    const timeTaken = attempt.endTime
      ? Math.floor(
          (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
        )
      : exam.duration * 60;

    return {
      attemptId: attempt._id,
      rank: attempt.rank || "N/A",
      user: {
        id: attempt.userId?._id || "Anonymous",
        name: attempt.userId?.fullName || "Anonymous User",
        email: attempt.userId?.email || "N/A",
        phone: attempt.userId?.phoneNumber || "N/A",
      },
      performance: {
        score: attempt.finalScore,
        outOf: exam.totalMarks,
        percentage: ((attempt.finalScore / exam.totalMarks) * 100).toFixed(2),
        correctAnswers: attempt.correctAnswers,
        wrongAnswers: attempt.wrongAnswers,
        unattempted: attempt.unattempted,
        negativeMarks: attempt.negativeMarks || 0,
        hasPassed: attempt.hasPassed,
      },
      timeTaken,
      timeTakenFormatted: formatTime(timeTaken),
      percentile: attempt.percentile?.toFixed(2) || "N/A",
      attemptedOn: attempt.createdAt,
    };
  });

  // Prepare response
  const responseData = {
    exam: {
      id: exam._id,
      title: exam.title,
      description: exam.description,
      totalQuestions: exam.totalQuestions,
      totalMarks: exam.totalMarks,
      duration: exam.duration,
      passMarkPercentage: exam.passMarkPercentage,
    },
    rankings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };

  // Cache the result for 2 minutes (shorter time for admin data that changes frequently)
  try {
    await examService.set(examService.examCache, cacheKey, responseData, 120);
  } catch (cacheError) {
    console.error("Failed to cache exam rankings:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

/**
 * Helper function to format time in readable format
 */
const formatTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hours > 0 ? hours + "h " : ""}${minutes}m ${secs}s`;
};

export default getAdminRankings;
