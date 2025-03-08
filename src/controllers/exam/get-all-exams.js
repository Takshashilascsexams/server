import Exam from "../../models/exam.models.js";
import { catchAsync } from "../../utils/errorHandler.js";

const getAllExams = catchAsync(async (req, res, next) => {
  // Pagination
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 10;
  const skip = (page - 1) * limit;

  // Build query
  const query = Exam.find().skip(skip).limit(limit).populate("analytics");

  // Execute query
  const exams = await query;

  // Get total count for pagination
  const total = await exams.countDocuments();

  res.status(200).json({
    status: "success",
    results: exams.length,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
    data: {
      exams,
    },
  });
});

export default getAllExams;
