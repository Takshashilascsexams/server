// src/controllers/exam-attempt/start-exam.js
import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { checkExamAccess } from "../../services/examAccessService.js";
import {
  examService,
  questionService,
  attemptService,
} from "../../services/redisService.js";
import mongoose from "mongoose";
import { loadBalancer } from "../../utils/loadBalancer.js";

/**
 * Controller to start a new exam attempt
 * - Optimized for high concurrency with 1000+ simultaneous users
 * - Uses distributed caching and connection pooling
 * - Implements rate limiting and load distribution
 * - Validates premium exam access
 */
const startExam = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Load balancing check - prevent overloading during high traffic
  if (await loadBalancer.isOverloaded()) {
    return next(
      new AppError(
        "Server is currently experiencing high traffic. Please try again in a few moments.",
        503
      )
    );
  }

  // Get user ID from token using cached lookup
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Check if exam exists and is active using cached lookup
  let exam;
  try {
    // Try to get exam from Redis cache first
    exam = await examService.getExam(examId);

    if (!exam) {
      // Cache miss - get from database and cache for future requests
      exam = await Exam.findById(examId)
        .select(
          "title description duration totalQuestions totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue allowNavigation isPremium isActive"
        )
        .lean();

      if (exam) {
        await examService.setExam(examId, exam, 60 * 60); // Cache for 1 hour
      }
    }
  } catch (error) {
    console.error(`Error fetching exam ${examId}:`, error);
    return next(new AppError("Failed to fetch exam details", 500));
  }

  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Check if exam is active
  if (!exam.isActive) {
    return next(new AppError("This exam is not currently active", 400));
  }

  // Check if user has access to the exam (for premium exams)
  if (exam.isPremium) {
    try {
      const hasAccess = await checkExamAccess(userId, examId);
      if (!hasAccess) {
        return next(
          new AppError("You don't have access to this premium exam", 403)
        );
      }
    } catch (error) {
      console.error(`Error checking exam access for user ${userId}:`, error);
      return next(new AppError("Failed to verify exam access", 500));
    }
  }

  // Check for an existing in-progress attempt using cache
  let existingAttempt;
  try {
    const attemptCacheKey = `user:${userId}:inprogress:${examId}`;
    const cachedAttemptId = await attemptService.getAttempt(attemptCacheKey);

    if (cachedAttemptId) {
      existingAttempt = await ExamAttempt.findById(cachedAttemptId)
        .select("_id timeRemaining createdAt")
        .lean();

      // Validate the cached attempt still exists and is in-progress
      if (!existingAttempt || existingAttempt.status !== "in-progress") {
        // Invalid cache, clear it
        await attemptService.deleteAttempt(attemptCacheKey);
        existingAttempt = null;
      }
    }

    // If not found in cache, check database
    if (!existingAttempt) {
      existingAttempt = await ExamAttempt.findOne({
        userId,
        examId,
        status: "in-progress",
      })
        .select("_id timeRemaining createdAt")
        .lean();

      // Cache the found attempt for future requests
      if (existingAttempt) {
        await attemptService.setAttempt(
          attemptCacheKey,
          existingAttempt._id.toString(),
          30 * 60
        ); // 30 minutes TTL
      }
    }
  } catch (error) {
    console.error(
      `Error checking existing attempts for user ${userId}:`,
      error
    );
    // Continue without caching on error
  }

  if (existingAttempt) {
    // Calculate remaining time for the existing attempt
    const now = new Date();
    const startTime = new Date(existingAttempt.createdAt);
    const elapsedMs = now - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const remainingSeconds = Math.max(0, exam.duration * 60 - elapsedSeconds);

    return res.status(200).json({
      status: "success",
      message: "Continuing existing attempt",
      data: {
        attemptId: existingAttempt._id,
        timeRemaining: existingAttempt.timeRemaining || remainingSeconds,
        resuming: true,
      },
    });
  }

  // Prepare for new attempt - get questions with distributed caching
  let questions;
  try {
    questions = await questionService.getQuestionsByExam(examId);

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      // Cache miss or empty cache - get from database
      questions = await Question.find({ examId, isActive: true })
        .select("_id")
        .lean();

      // Cache for future requests
      if (questions && questions.length > 0) {
        await questionService.setQuestionsByExam(examId, questions, 60 * 60); // 1 hour TTL
      }
    }
  } catch (error) {
    console.error(`Error fetching questions for exam ${examId}:`, error);
    return next(new AppError("Failed to fetch exam questions", 500));
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

  // Use a MongoDB session for transaction
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    // Select random questions if we have more than needed
    let selectedQuestionIds = questions.map((q) => q._id);
    if (questions.length > exam.totalQuestions) {
      // Shuffle the array of question IDs
      selectedQuestionIds = questions
        .map((q) => q._id)
        .sort(() => Math.random() - 0.5);
      // Take only the required number
      selectedQuestionIds = selectedQuestionIds.slice(0, exam.totalQuestions);
    }

    // Create a new attempt record
    const newAttempt = new ExamAttempt({
      userId,
      examId,
      startTime: new Date(),
      status: "in-progress",
      timeRemaining: exam.duration * 60, // Convert minutes to seconds
      answers: selectedQuestionIds.map((questionId) => ({
        questionId,
        selectedOption: null,
        isCorrect: null,
        marksEarned: 0,
        negativeMarks: 0,
      })),
      unattempted: selectedQuestionIds.length,
    });

    await newAttempt.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Cache the new attempt
    try {
      const attemptCacheKey = `user:${userId}:inprogress:${examId}`;
      await attemptService.setAttempt(
        attemptCacheKey,
        newAttempt._id.toString(),
        30 * 60
      ); // 30 minutes TTL
    } catch (error) {
      // Log but continue if caching fails
      console.error(`Failed to cache new attempt for user ${userId}:`, error);
    }

    // Return minimal information to start the exam
    res.status(201).json({
      status: "success",
      data: {
        attemptId: newAttempt._id,
        timeRemaining: exam.duration * 60, // in seconds
        resuming: false,
      },
    });
  } catch (error) {
    console.error(`Error creating exam attempt for user ${userId}:`, error);

    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    return next(new AppError("Failed to start exam. Please try again.", 500));
  }
});

export default startExam;
