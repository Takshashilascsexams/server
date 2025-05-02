import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import User from "../../models/user.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";

/**
 * Controller to get rankings for a specific exam
 * - Returns top performers with detailed stats
 * - Includes user's own rank if available
 */
const getExamRankings = catchAsync(async (req, res, next) => {
  const { examId } = req.params;
  const { limit = 10 } = req.query;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get user ID from token (if authenticated)
  let userId = null;
  try {
    userId = req.user?.sub ? await getUserId(req.user.sub) : null;
  } catch (error) {
    console.log("User not authenticated, proceeding with public rankings");
  }

  // Get top attempts for this exam
  const topAttempts = await ExamAttempt.find({
    examId,
    status: "completed",
  })
    .sort({ finalScore: -1, endTime: 1 }) // Sort by score (desc) and then by end time (asc) for tiebreakers
    .limit(parseInt(limit))
    .populate({
      path: "userId",
      select: "fullName avatar",
    })
    .lean();

  // Format the response data
  const rankings = topAttempts.map((attempt) => {
    return {
      rank: attempt.rank,
      score: attempt.finalScore,
      percentage: ((attempt.finalScore / exam.totalMarks) * 100).toFixed(2),
      user: {
        id: attempt.userId?._id || "Anonymous",
        name: attempt.userId?.fullName || "Anonymous User",
        avatar: attempt.userId?.avatar || null,
      },
      correctAnswers: attempt.correctAnswers,
      wrongAnswers: attempt.wrongAnswers,
      unattempted: attempt.unattempted,
      timeTaken: attempt.endTime
        ? Math.floor((attempt.endTime - attempt.startTime) / 1000)
        : exam.duration * 60,
      percentile: attempt.percentile,
      attemptId: attempt._id,
      attemptedOn: attempt.createdAt,
    };
  });

  // If user is authenticated, get their rank
  let userRanking = null;
  if (userId) {
    const userAttempt = await ExamAttempt.findOne({
      examId,
      userId,
      status: "completed",
    })
      .sort({ finalScore: -1 })
      .populate({
        path: "userId",
        select: "fullName avatar",
      })
      .lean();

    if (userAttempt) {
      userRanking = {
        rank: userAttempt.rank,
        score: userAttempt.finalScore,
        percentage: ((userAttempt.finalScore / exam.totalMarks) * 100).toFixed(
          2
        ),
        user: {
          id: userAttempt.userId?._id || userId,
          name: userAttempt.userId?.fullName || "You",
          avatar: userAttempt.userId?.avatar || null,
        },
        correctAnswers: userAttempt.correctAnswers,
        wrongAnswers: userAttempt.wrongAnswers,
        unattempted: userAttempt.unattempted,
        timeTaken: userAttempt.endTime
          ? Math.floor((userAttempt.endTime - userAttempt.startTime) / 1000)
          : exam.duration * 60,
        percentile: userAttempt.percentile,
        attemptId: userAttempt._id,
        attemptedOn: userAttempt.createdAt,
        isCurrentUser: true,
      };
    }
  }

  // Total number of attempts
  const totalAttempts = await ExamAttempt.countDocuments({
    examId,
    status: "completed",
  });

  res.status(200).json({
    status: "success",
    data: {
      exam: {
        id: exam._id,
        title: exam.title,
        totalMarks: exam.totalMarks,
        totalQuestions: exam.totalQuestions,
        duration: exam.duration,
      },
      rankings,
      userRanking,
      totalAttempts,
    },
  });
});

export default getExamRankings;
