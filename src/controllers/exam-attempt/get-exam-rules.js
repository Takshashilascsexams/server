// src/controllers/exam-attempt/get-exam-rules.js
import Exam from "../../models/exam.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { examService } from "../../services/redisService.js";
import { checkExamAccess } from "../../services/examAccessService.js";

/**
 * Controller to get exam rules and information before starting
 * - Optimized for high traffic with caching
 * - Validates user access to premium exams
 * - Returns exam rules with clear instructions
 */
const getExamRules = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from token with caching
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Create a cache key that's specific to this user and exam
  const cacheKey = `rules:${examId}:${userId}`;

  // Try to get exam rules from cache first
  try {
    const cachedRules = await examService.getExamRules(cacheKey);
    if (cachedRules) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: {
          exam: cachedRules,
        },
      });
    }
  } catch (error) {
    // Just log the error but continue with database lookup
    console.error("Cache miss for exam rules:", error);
  }

  // Cache miss, so fetch from database
  // Get exam with selective fields to reduce data transfer
  let exam;
  try {
    exam = await Exam.findById(examId)
      .select(
        "title description duration totalQuestions totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue allowNavigation category difficultyLevel isPremium isActive"
      )
      .lean();
  } catch (error) {
    console.error(`Database error fetching exam ${examId}:`, error);
    return next(new AppError("Failed to fetch exam details", 500));
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
    try {
      hasAccess = await checkExamAccess(userId, examId);
    } catch (error) {
      console.error(`Error checking exam access for user ${userId}:`, error);
      return next(new AppError("Failed to verify exam access", 500));
    }

    if (!hasAccess) {
      return next(
        new AppError("You don't have access to this premium exam", 403)
      );
    }
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
      `Each question carries ${(exam.totalMarks / exam.totalQuestions).toFixed(
        2
      )} marks.`,
      `Passing mark is ${exam.passMarkPercentage}% of total marks.`,
      exam.hasNegativeMarking
        ? `Negative marking of ${exam.negativeMarkingValue} marks for each wrong answer.`
        : "There is no negative marking for wrong answers.",
      exam.allowNavigation
        ? "You can navigate between questions freely during the exam."
        : "Once you move to the next question, you cannot go back to previous questions.",
      "Do not refresh the page during the exam as it may lead to loss of answers.",
      "The exam will auto-submit when the time runs out.",
      "In case of internet disconnection, your progress will be saved automatically.",
    ],
    instructions: [
      "Read all questions carefully before answering.",
      "Click on the 'Save & Next' button to save your answer and move to the next question.",
      "You can see your remaining time at the top of the exam page.",
      "Use the question palette to navigate between questions if navigation is allowed.",
      "Click on the 'Submit' button when you have completed the exam.",
    ],
  };

  // Cache the rules for future requests (short TTL since it includes user-specific access info)
  try {
    await examService.setExamRules(cacheKey, examRules, 5 * 60); // 5 minutes TTL
  } catch (error) {
    // Just log the error but don't fail the request
    console.error("Failed to cache exam rules:", error);
  }

  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      exam: examRules,
    },
  });
});

export default getExamRules;
