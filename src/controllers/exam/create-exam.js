import Exam from "../../models/exam.models.js";
import ExamAnalytics from "../../models/examAnalytics.models.js";
import { catchAsync } from "../../utils/errorHandler.js";

const createExam = catchAsync(async (req, res, next) => {
  // Add current user as creator
  req.body.createdBy = req.user._id;

  // Create the test series
  const newExam = await Exam.create(req.body);

  // Initialize analytics for this test series
  await ExamAnalytics.create({
    testSeriesId: newExam._id,
    totalAttempted: 0,
    totalCompleted: 0,
    highestScore: 0,
    lowestScore: 0,
    averageScore: 0,
    passCount: 0,
    failCount: 0,
    passPercentage: 0,
    failPercentage: 0,
  });

  res.status(201).json({
    status: "success",
    data: {
      exam: newExam,
    },
  });
});

export default createExam;
