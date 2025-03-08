import Exam from "../../models/exam.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";

const updateExam = catchAsync(async (req, res, next) => {
  const examId = req.params.id;

  // Find and update the test series
  const updatedExam = await Exam.findByIdAndUpdate(examId, req.body, {
    new: true, // Return the updated document
    runValidators: true, // Run validators on update
  });

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

export default updateExam;
