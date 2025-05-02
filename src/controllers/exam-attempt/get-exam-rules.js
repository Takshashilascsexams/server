import Exam from "../../models/exam.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { examService } from "../../services/redisService.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import checkExamAccess from "../payment/check-access.js";

/**
 * Controller to get exam rules and information before starting
 * Optimized for high concurrency with caching
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

  // Define cache keys
  const examCacheKey = `exam:${examId}`;
  const rulesCacheKey = `rules:${examId}`;
  const accessCacheKey = `access:${userId}:${examId}`;

  // Try to get rules from cache first
  try {
    const cachedRules = await examService.getExamRules(examId);
    if (cachedRules) {
      // For premium exams, we still need to check access
      let hasAccess = true;

      if (cachedRules.isPremium) {
        try {
          // Check access from cache
          const cachedAccess = await examService.examCache.get(accessCacheKey);
          if (cachedAccess !== null) {
            hasAccess = cachedAccess === "true";
          } else {
            // If not in cache, check access using the controller
            req.params = { examId };
            const accessResult = await checkExamAccess(req, {}, (error) => {
              if (error) throw error;
            });

            hasAccess = accessResult.data.hasAccess;

            // Cache the access result
            await examService.examCache.set(
              accessCacheKey,
              hasAccess ? "true" : "false",
              "EX",
              5 * 60 // Short TTL to maintain freshness
            );
          }
        } catch (error) {
          console.error("Error checking exam access:", error);
          // Fallback to direct access check
          req.params = { examId };
          try {
            const accessResult = await checkExamAccess(req, {}, (error) => {
              if (error) throw error;
            });
            hasAccess = accessResult.data.hasAccess;
          } catch (accessError) {
            console.error("Fallback access check failed:", accessError);
            hasAccess = false;
          }
        }
      }

      // Return cached rules with updated access
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: {
          exam: {
            ...cachedRules,
            hasAccess,
          },
        },
      });
    }
  } catch (error) {
    console.error("Error fetching rules from cache:", error);
    // Continue to database fetch on cache error
  }

  // Get the exam data - try cache first
  let exam;
  try {
    exam = await examService.getExam(examId);
    if (!exam) {
      // Cache miss - fetch from database
      exam = await Exam.findById(examId)
        .select(
          "title description isActive isPremium duration totalQuestions totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue allowNavigation category difficultyLevel"
        )
        .lean();

      if (exam) {
        // Cache for future requests
        await examService.setExam(examId, exam);
      }
    }
  } catch (error) {
    console.error("Error fetching exam from cache:", error);
    // Fallback to database query
    exam = await Exam.findById(examId)
      .select(
        "title description isActive isPremium duration totalQuestions totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue allowNavigation category difficultyLevel"
      )
      .lean();
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
      // Check access from cache
      const cachedAccess = await examService.examCache.get(accessCacheKey);
      if (cachedAccess !== null) {
        hasAccess = cachedAccess === "true";
      } else {
        // Cache miss - check access using controller
        req.params = { examId };
        const accessResult = await checkExamAccess(req, {}, (error) => {
          if (error) throw error;
        });

        hasAccess = accessResult.data.hasAccess;

        // Cache the access result
        await examService.examCache.set(
          accessCacheKey,
          hasAccess ? "true" : "false",
          "EX",
          5 * 60 // Short TTL to maintain freshness
        );
      }
    } catch (error) {
      console.error("Error checking exam access:", error);
      // Fallback to direct access check
      req.params = { examId };
      try {
        const accessResult = await checkExamAccess(req, {}, (error) => {
          if (error) throw error;
        });
        hasAccess = accessResult.data.hasAccess;
      } catch (accessError) {
        console.error("Fallback access check failed:", accessError);
        hasAccess = false;
      }
    }
  }

  // Prepare exam rules
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
    isPremium: exam.isPremium,
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
        ? "You can navigate between questions freely."
        : "Once you move to the next question, you cannot go back.",
      "Do not refresh the page during the exam.",
      "The exam will auto-submit when the time runs out.",
    ],
  };

  // Cache rules for future requests
  try {
    // Omit hasAccess from cache, as that's user-specific
    const { hasAccess, ...rulesToCache } = examRules;
    await examService.setExamRules(examId, rulesToCache, 24 * 60 * 60); // Cache for 24 hours
  } catch (error) {
    console.error("Error caching exam rules:", error);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      exam: examRules,
    },
  });
});

export default getExamRules;
