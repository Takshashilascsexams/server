import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { examService } from "../../services/redisService.js";

/**
 * Controller to calculate and update rankings for a specific exam
 * - Calculates rank (position) and percentile for each attempt
 * - Used by admin to update rankings periodically
 */
const calculateRankings = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get all completed attempts for this exam, sorted by score
  const attempts = await ExamAttempt.find({
    examId,
    status: "completed",
  })
    .sort({ finalScore: -1 })
    .select("_id finalScore")
    .lean();

  if (attempts.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "No completed attempts found for this exam",
      data: {
        totalAttempts: 0,
        updatedRankings: 0,
      },
    });
  }

  // Calculate rank and percentile
  const totalAttempts = attempts.length;
  const updatedAttempts = [];

  for (let i = 0; i < attempts.length; i++) {
    // Handle tied scores (same rank)
    let rank = i + 1;
    if (i > 0 && attempts[i].finalScore === attempts[i - 1].finalScore) {
      rank = updatedAttempts[i - 1].rank; // Same rank as previous
    }

    // Calculate percentile (higher is better)
    const percentile = ((totalAttempts - rank) / totalAttempts) * 100;

    // Update the attempt
    const updatedAttempt = await ExamAttempt.findByIdAndUpdate(
      attempts[i]._id,
      {
        rank,
        percentile: parseFloat(percentile.toFixed(2)),
      },
      { new: true }
    );

    updatedAttempts.push(updatedAttempt);
  }

  // Clear exam cache to refresh any cached data
  await examService.clearExamCache();

  res.status(200).json({
    status: "success",
    message: "Rankings calculated and updated",
    data: {
      totalAttempts,
      updatedRankings: updatedAttempts.length,
    },
  });
});

export default calculateRankings;
