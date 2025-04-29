import Exam from "../../models/exam.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { examService } from "../../services/redisService.js";
import checkExamAccess from "../payment/check-access.js";

/**
 * Controller to get exam rules and information before starting
 */
const getExamRules = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Try to get exam from cache first
  let exam;
  try {
    exam = await examService.getExam(examId);
    if (!exam) {
      exam = await Exam.findById(examId);
      if (exam) {
        await examService.setExam(examId, exam);
      }
    }
  } catch (error) {
    console.error("Error fetching exam from cache:", error);
    exam = await Exam.findById(examId);
  }

  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Check if exam is active
  if (!exam.isActive) {
    return next(new AppError("This exam is not currently active", 400));
  }

  // Check if user has access to premium exam
  let hasAccess = true;
  if (exam.isPremium) {
    // Use existing check-access controller
    req.params = { examId };
    const accessResult = await checkExamAccess(req, {}, (error) => {
      if (error) return next(error);
    });

    hasAccess = accessResult.data.hasAccess;
  }

  // Prepare exam rules for response
  const examRules = {
    id: exam._id,
    title: exam.title,
    description: exam.description,
    duration: exam.duration,
    totalQuestions: exam.totalQuestions,
    totalMarks: exam.totalMarks,
    passMarkPercentage: exam.passMarkPercentage,
    hasNegativeMarking: exam.hasNegativeMarking,
    negativeMarkingValue: exam.negativeMarkingValue,
    allowNavigation: exam.allowNavigation,
    category: exam.category,
    difficultyLevel: exam.difficultyLevel,
    hasAccess,
    rules: [
      `The exam contains ${exam.totalQuestions} questions to be completed in ${exam.duration} minutes.`,
      `Each question carries ${exam.totalMarks / exam.totalQuestions} marks.`,
      `Passing mark is ${exam.passMarkPercentage}% of total marks.`,
      exam.hasNegativeMarking
        ? `Negative marking of ${exam.negativeMarkingValue} marks for each wrong answer.`
        : "There is no negative marking for wrong answers.",
      exam.allowNavigation
        ? "You can navigate between questions freely."
        : "Once you move to the next question, you cannot go back.",
      "Do not refresh the page during the exam.",
      "The exam will auto-submit when the time runs out.",
    ],
  };

  res.status(200).json({
    status: "success",
    data: {
      exam: examRules,
    },
  });
});

export default getExamRules;
