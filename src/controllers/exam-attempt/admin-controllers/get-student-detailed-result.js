import ExamAttempt from "../../../models/examAttempt.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

/**
 * Controller to get detailed student result for a specific attempt
 */
const getStudentDetailedResult = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Check cache first
  const cacheKey = `admin:student:result:${attemptId}`;
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
    console.error("Cache error in getStudentDetailedResult:", error);
  }

  // Find the attempt with populated data
  const attempt = await ExamAttempt.findById(attemptId)
    .populate("examId")
    .populate({
      path: "userId",
      select:
        "fullName email phoneNumber alternatePhoneNumber dateOfBirth gender category address district highestEducation",
    });

  if (!attempt) {
    return next(new AppError("Attempt not found", 404));
  }

  // Calculate time stats
  const timeTaken = attempt.endTime
    ? Math.floor(
        (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
      )
    : attempt.examId.duration * 60;

  // Calculate answer timing statistics
  const answerTimings = attempt.answers
    .map((answer) => answer.responseTime)
    .filter((time) => time > 0);
  const avgAnswerTime = answerTimings.length
    ? answerTimings.reduce((sum, time) => sum + time, 0) / answerTimings.length
    : 0;
  const maxAnswerTime = answerTimings.length ? Math.max(...answerTimings) : 0;
  const minAnswerTime = answerTimings.length ? Math.min(...answerTimings) : 0;

  // Prepare detailed result
  const detailedResult = {
    attempt: {
      id: attempt._id,
      status: attempt.status,
      startTime: attempt.startTime,
      endTime: attempt.endTime,
      timeRemaining: attempt.timeRemaining,
      timeTaken,
      timeTakenFormatted: formatTime(timeTaken),
    },
    exam: {
      id: attempt.examId._id,
      title: attempt.examId.title,
      description: attempt.examId.description,
      totalQuestions: attempt.examId.totalQuestions,
      totalMarks: attempt.examId.totalMarks,
      duration: attempt.examId.duration,
      passMarkPercentage: attempt.examId.passMarkPercentage,
    },
    student: attempt.userId
      ? {
          id: attempt.userId._id,
          name: attempt.userId.fullName,
          email: attempt.userId.email,
          phone: attempt.userId.phoneNumber,
          alternatePhone: attempt.userId.alternatePhoneNumber,
          dateOfBirth: attempt.userId.dateOfBirth,
          gender: attempt.userId.gender,
          category: attempt.userId.category,
          address: attempt.userId.address,
          district: attempt.userId.district,
          highestEducation: attempt.userId.highestEducation,
        }
      : {
          name: "Anonymous User",
          email: "N/A",
          phone: "N/A",
        },
    performance: {
      totalMarks: attempt.totalMarks,
      negativeMarks: attempt.negativeMarks,
      finalScore: attempt.finalScore,
      percentage: (
        (attempt.finalScore / attempt.examId.totalMarks) *
        100
      ).toFixed(2),
      correctAnswers: attempt.correctAnswers,
      wrongAnswers: attempt.wrongAnswers,
      unattempted: attempt.unattempted,
      hasPassed: attempt.hasPassed,
      rank: attempt.rank,
      percentile: attempt.percentile,
    },
    timing: {
      average: avgAnswerTime.toFixed(2),
      maximum: maxAnswerTime,
      minimum: minAnswerTime,
      distribution: calculateTimeDistribution(answerTimings),
    },
  };

  // Cache the result for 5 minutes
  try {
    await examService.set(examService.examCache, cacheKey, detailedResult, 300);
  } catch (cacheError) {
    console.error("Failed to cache student detailed result:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: detailedResult,
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

/**
 * Helper function to calculate time distribution for analytics
 */
const calculateTimeDistribution = (timings) => {
  if (!timings.length) return {};

  // Create time buckets (0-15s, 16-30s, 31-60s, 61-120s, 120s+)
  const distribution = {
    quick: 0, // 0-15s
    normal: 0, // 16-30s
    medium: 0, // 31-60s
    long: 0, // 61-120s
    extended: 0, // 120s+
  };

  timings.forEach((time) => {
    if (time <= 15) distribution.quick++;
    else if (time <= 30) distribution.normal++;
    else if (time <= 60) distribution.medium++;
    else if (time <= 120) distribution.long++;
    else distribution.extended++;
  });

  // Convert to percentages
  Object.keys(distribution).forEach((key) => {
    distribution[key] = ((distribution[key] / timings.length) * 100).toFixed(2);
  });

  return distribution;
};

export default getStudentDetailedResult;
