import Exam from "../../models/exam.models.js";
import { catchAsync } from "../../utils/errorHandler.js";

const getSingleExam = catchAsync(async (req, res, next) => {
  const examId = req.params.id;

  // Find the test series and populate analytics
  const exam = await Exam.findById(examId).populate("analytics");

  // Check if test series exists
  if (!exam) {
    return next(new AppError("No exam found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      exam,
    },
  });
});

export default getSingleExam;
