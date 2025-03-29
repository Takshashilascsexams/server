import Exam from "../../../models/exam.models.js";
import ExamAnalytics from "../../../models/examAnalytics.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  examService,
  analyticsService,
} from "../../../services/redisService.js";

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
    ].some((value) => value === null || value === undefined)
  ) {
    return next(
      new AppError("Please provide all the fields for a new exam", 400)
    );
  }

  const userId = await getUserId(req.user.sub);

  if (!userId) {
    return next(new AppError("User not found", 404));
  }

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
    createdBy: userId,
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

  const examAnalytics = await ExamAnalytics.create(newExamAnalyticsBody);

  // Cache the new exam and its analytics
  await Promise.all([
    examService.setExam(newExam._id.toString(), newExam.toJSON()),
    examService.setExamExists(newExam._id.toString(), true),
    analyticsService.setAnalytics(
      newExam._id.toString(),
      examAnalytics.toJSON()
    ),
    // Clear the "all exams" cache since we've added a new exam
    examService.clearExamCache(),
  ]);

  res.status(201).json({
    status: "success",
    data: {
      exam: newExam,
    },
  });
});

export default createExam;
