import Exam from "../../../models/exam.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";
import mongoose from "mongoose";

const getExamDetails = catchAsync(async (req, res, next) => {
  const { id: examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Try to get from cache first
  const cacheKey = `admin:exam:details:${examId}`;
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
    console.error("Cache error in getExamDetails:", error);
  }

  // Get exam with analytics
  const exam = await Exam.findById(examId).populate("analytics");

  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get attempt statistics
  const attemptStats = await ExamAttempt.aggregate([
    { $match: { examId: new mongoose.Types.ObjectId(examId) } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  // Format attempt statistics
  const attemptStatsByStatus = attemptStats.reduce(
    (acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    },
    {
      "in-progress": 0,
      completed: 0,
      "timed-out": 0,
      paused: 0,
    }
  );

  // Get pass/fail statistics
  const passFailStats = await ExamAttempt.aggregate([
    {
      $match: {
        examId: new mongoose.Types.ObjectId(examId),
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$hasPassed",
        count: { $sum: 1 },
        avgScore: { $avg: "$finalScore" },
        maxScore: { $max: "$finalScore" },
        minScore: { $min: "$finalScore" },
      },
    },
  ]);

  // Format pass/fail statistics
  const passFailStatsByResult = passFailStats.reduce(
    (acc, stat) => {
      const key = stat._id ? "passed" : "failed";
      acc[key] = {
        count: stat.count,
        avgScore: stat.avgScore,
        maxScore: stat.maxScore,
        minScore: stat.minScore,
      };
      return acc;
    },
    {
      passed: { count: 0, avgScore: 0, maxScore: 0, minScore: 0 },
      failed: { count: 0, avgScore: 0, maxScore: 0, minScore: 0 },
    }
  );

  // Prepare response data
  const responseData = {
    exam: exam.toJSON(),
    attempts: {
      total: Object.values(attemptStatsByStatus).reduce((a, b) => a + b, 0),
      byStatus: attemptStatsByStatus,
    },
    results: passFailStatsByResult,
  };

  // Cache the result for 5 minutes
  try {
    await examService.set(examService.examCache, cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache exam details:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getExamDetails;
