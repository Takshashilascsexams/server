import Exam from "../../models/exam.models.js";
import User from "../../models/user.models.js";
import ExamAnalytics from "../../models/examAnalytics.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";

const createExam = catchAsync(async (req, res, next) => {
  const {
    title,
    description,
    duration,
    totalQuestions,
    totalMarks,
    hasNegativeMarking,
    negativeMarkingValue,
    passMarkPercentage,
    difficultyLevel,
    category,
    allowNavigation,
  } = req.body;

  if (
    [
      title,
      description,
      duration,
      totalQuestions,
      totalMarks,
      hasNegativeMarking,
      negativeMarkingValue,
      passMarkPercentage,
      difficultyLevel,
      category,
      allowNavigation,
    ].some((value) => value === null && value === undefined)
  ) {
    return next(
      new AppError("Please provide all the fields for a new exam", 401)
    );
  }

  const user = await User.findOne({ clerkId: req.user.sub });

  const newExamBody = {
    title,
    description,
    duration: parseInt(duration),
    totalQuestions: parseInt(totalQuestions),
    totalMarks: parseInt(totalMarks),
    hasNegativeMarking: hasNegativeMarking === "Yes" ? true : false,
    negativeMarkingValue: parseInt(negativeMarkingValue),
    passMarkPercentage: parseInt(passMarkPercentage),
    difficultyLevel,
    category,
    allowNavigation: allowNavigation === "Yes" ? true : false,
    createdBy: user._id,
  };

  // Create the test series
  const newExam = await Exam.create(newExamBody);

  // Initialize analytics for this test series
  const newExamAnalyticsBody = {
    examId: newExam._id,
    totalAttempted: 0,
    totalCompleted: 0,
    highestScore: 0,
    lowestScore: 0,
    averageScore: 0,
    passCount: 0,
    failCount: 0,
    passPercentage: 0,
    failPercentage: 0,
  };

  await ExamAnalytics.create(newExamAnalyticsBody);

  res.status(201).json({
    status: "success",
    data: {
      exam: newExam,
    },
  });
});

export default createExam;
