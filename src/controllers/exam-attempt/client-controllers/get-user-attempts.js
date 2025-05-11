import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";

/**
 * Controller to get all attempts by a user
 * - Can filter by exam ID or status
 * - Returns paginated results
 */
const getUserAttempts = catchAsync(async (req, res, next) => {
  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Get filter parameters
  const { examId, status, page = 1, limit = 10 } = req.query;

  // Build query
  const query = { userId };

  if (examId) {
    query.examId = examId;
  }

  if (status) {
    query.status = status;
  }

  // Pagination
  const skip = (page - 1) * limit;

  // Find attempts
  const attempts = await ExamAttempt.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate({
      path: "examId",
      select: "title description category duration totalMarks",
    })
    .lean();

  // Get total count for pagination
  const total = await ExamAttempt.countDocuments(query);

  res.status(200).json({
    status: "success",
    data: {
      attempts,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit),
      },
    },
  });
});

export default getUserAttempts;
