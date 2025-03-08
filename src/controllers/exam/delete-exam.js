import Exam from "../../models/exam.models.js";
import ExamAnalytics from "../../models/examAnalytics.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";

const deleteExam = catchAsync(async (req, res, next) => {
  const examId = req.params.id;

  // Find and delete the test series
  const deletedExam = await Exam.findByIdAndDelete(examId);

  // Check if test series exists
  if (!deletedExam) {
    return next(new AppError("No exam found with that ID", 404));
  }

  // Also delete related analytics
  await ExamAnalytics.findOneAndDelete({ examId });

  // 204 = No Content
  res.status(204).json({
    status: "success",
    data: null,
  });
});

export default deleteExam;
