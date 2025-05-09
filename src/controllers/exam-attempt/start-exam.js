import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import checkExamAccess from "../payment/check-access.js";
import { examService, questionService } from "../../services/redisService.js";

/**
 * Controller to start a new exam attempt
 * Optimized for 1000+ concurrent users
 */

const startExam = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from token with caching
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Use a multi-phase approach to reduce database load
  let exam;
  let questions;
  let hasAccess = false;
  let existingAttempt;

  // Phase 1: Check for an existing attempt in cache first
  try {
    // Check if user already has an active attempt using the new helper method
    existingAttempt = await examService.getExamAttempt(userId, examId);
    if (existingAttempt) {
      // No need to parse the result - it's already processed by the getExamAttempt method

      // Verify the attempt still exists in the database
      const attemptExists = await ExamAttempt.exists({
        _id: existingAttempt.attemptId,
        userId,
        examId,
        status: "in-progress",
      });

      if (attemptExists) {
        return res.status(200).json({
          status: "success",
          message: "Continuing existing attempt",
          data: {
            attemptId: existingAttempt.attemptId,
            timeRemaining:
              existingAttempt.timeRemaining ||
              existingAttempt.examDuration * 60,
            resuming: true,
          },
        });
      }
    }
  } catch (error) {
    console.error("Error checking existing attempt:", error);
    // Continue with normal flow if cache check fails
  }

  // Phase 2: Get exam data - use cache first approach
  try {
    // Try to get from Redis cache first
    exam = await examService.getExam(examId);
    if (!exam) {
      // Cache miss - get from database with optimized projection
      exam = await Exam.findById(examId)
        .select(
          "title description isActive isPremium duration totalQuestions totalMarks"
        )
        .lean();

      if (!exam) {
        return next(new AppError("Exam not found", 404));
      }

      // Cache for future requests
      await examService.setExam(examId, exam);
    }
  } catch (error) {
    console.error("Error fetching exam data:", error);
    // Fallback to database
    exam = await Exam.findById(examId)
      .select(
        "title description isActive isPremium duration totalQuestions totalMarks"
      )
      .lean();

    if (!exam) {
      return next(new AppError("Exam not found", 404));
    }
  }

  // Check if exam is active
  if (!exam.isActive) {
    return next(new AppError("This exam is not currently active", 400));
  }

  // Phase 3: Check if user has access to the exam (for premium exams)
  if (exam.isPremium) {
    try {
      // Try to get access status from cache using the new helper method
      const cachedAccess = await examService.getExamAccess(userId, examId);

      if (cachedAccess !== null) {
        hasAccess = cachedAccess === "true";
      } else {
        // Cache miss - check access via controller
        req.params = { examId };
        const accessResult = await checkExamAccess(req, {}, (error) => {
          if (error) throw error;
        });

        hasAccess = accessResult.data.hasAccess;

        // Cache for future requests using the new helper method
        await examService.setExamAccess(userId, examId, hasAccess);
      }
    } catch (error) {
      console.error("Error checking exam access:", error);
      // Fallback to direct controller call
      req.params = { examId };
      try {
        const accessResult = await checkExamAccess(req, {}, (error) => {
          if (error) throw error;
        });
        hasAccess = accessResult.data.hasAccess;
      } catch (accessError) {
        return next(new AppError("Failed to verify exam access", 500));
      }
    }

    if (!hasAccess) {
      return next(
        new AppError("You don't have access to this premium exam", 403)
      );
    }
  }

  // Phase 4: Check for existing in-progress attempt in database
  existingAttempt = await ExamAttempt.findOne({
    userId,
    examId,
    status: "in-progress",
  })
    .select("_id timeRemaining")
    .lean();

  if (existingAttempt) {
    // Cache the existing attempt using the new helper method
    try {
      await examService.setExamAttempt(
        userId,
        examId,
        {
          attemptId: existingAttempt._id,
          timeRemaining: existingAttempt.timeRemaining,
          examDuration: exam.duration,
        },
        exam.duration * 60 // TTL matches exam duration
      );
    } catch (error) {
      console.error("Error caching existing attempt:", error);
    }

    return res.status(200).json({
      status: "success",
      message: "Continuing existing attempt",
      data: {
        attemptId: existingAttempt._id,
        timeRemaining: existingAttempt.timeRemaining || exam.duration * 60,
        resuming: true,
      },
    });
  }

  // Phase 5: Get questions - try cache first approach with optimized fields
  try {
    // Try to get from Redis cache first
    questions = await questionService.getQuestionsByExam(examId);

    if (!questions || questions.length === 0) {
      // Cache miss - get from database with optimized projection
      questions = await Question.find({
        examId,
        isActive: true,
      })
        // .select("_id marks hasNegativeMarking negativeMarks")
        .select("_id questionText marks type options statements")
        .lean();

      if (questions.length > 0) {
        // Cache for future requests - do this in the background
        setTimeout(() => {
          questionService
            .setQuestionsByExam(examId, questions)
            .catch((error) => console.error("Error caching questions:", error));
        }, 0);
      }
    }
  } catch (error) {
    console.error("Error fetching questions:", error);
    // Fallback to database
    questions = await Question.find({
      examId,
      isActive: true,
    })
      .select("_id marks hasNegativeMarking negativeMarks")
      .lean();
  }

  if (!questions || questions.length === 0) {
    return next(new AppError("No questions found for this exam", 404));
  }

  // Check if we have enough questions
  if (questions.length < exam.totalQuestions) {
    return next(
      new AppError(
        `Not enough questions available. Required: ${exam.totalQuestions}, Available: ${questions.length}`,
        400
      )
    );
  }

  // Select random questions - use Fisher-Yates shuffle for efficiency
  let selectedQuestions = questions;
  if (questions.length > exam.totalQuestions) {
    // Efficient random selection without duplicates
    const indices = Array.from({ length: questions.length }, (_, i) => i);

    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Take first n elements
    const selectedIndices = indices.slice(0, exam.totalQuestions);
    selectedQuestions = selectedIndices.map((i) => questions[i]);
  }

  // Create a new attempt record with optimized fields
  const startTime = new Date();
  const timeRemaining = exam.duration * 60; // seconds

  // Create a new attempt record
  const newAttempt = await ExamAttempt.create({
    userId,
    examId,
    startTime,
    status: "in-progress",
    timeRemaining,
    // Only store essential data in answers array
    answers: selectedQuestions.map((q) => ({
      questionId: q._id,
      selectedOption: null,
      isCorrect: null,
      marksEarned: 0,
      negativeMarks: 0,
      responseTime: 0,
    })),
    unattempted: selectedQuestions.length,
  });

  // Cache the new attempt using the new helper method
  try {
    await examService.setExamAttempt(
      userId,
      examId,
      {
        attemptId: newAttempt._id,
        timeRemaining,
        examDuration: exam.duration,
        createdAt: startTime.getTime(),
      },
      exam.duration * 120 // 2x exam duration as safety margin
    );
  } catch (error) {
    console.error("Error caching new attempt:", error);
  }

  // Prefetch full question details in background for this exam
  try {
    setTimeout(() => {
      questionService
        .prefetchQuestionsForExam(examId, selectedQuestions)
        .catch((error) => console.error("Error prefetching questions:", error));
    }, 0);
  } catch (error) {
    console.error("Error scheduling question prefetch:", error);
  }

  // Return minimal information to start the exam
  res.status(201).json({
    status: "success",
    data: {
      attemptId: newAttempt._id,
      timeRemaining,
      resuming: false,
    },
  });
});

export default startExam;
