import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";

const updateExamStatus = catchAsync(async (req, res, next) => {
  const examId = req.params.id;

  // Check if isActive is provided in the request
  if (req.body.isActive === undefined) {
    return next(new AppError("Please provide isActive status", 400));
  }

  // Find and update only the isActive status
  const updatedExam = await Exam.findByIdAndUpdate(
    examId,
    { isActive: req.body.isActive },
    {
      new: true,
      runValidators: true,
    }
  );

  // Check if test series exists
  if (!updatedExam) {
    return next(new AppError("No exam found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      exam: updatedExam,
    },
  });
});

export default updateExamStatus;
