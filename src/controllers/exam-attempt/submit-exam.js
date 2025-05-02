// src/controllers/exam-attempt/submit-exam.js - Optimized for high concurrency
import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import {
  examService,
  analyticsService,
  questionService,
  attemptService,
} from "../../services/redisService.js";
import mongoose from "mongoose";

/**
 * Controller to submit an exam and calculate results
 * Optimized for high concurrency with 1000+ simultaneous submissions
 */
const submitExam = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token with read-through cache
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Find the exam attempt - use projection to reduce data transfer
  const attempt = await ExamAttempt.findById(attemptId)
    .select("+answers +status +userId +examId +timeRemaining")
    .lean();

  if (!attempt) {
    return next(new AppError("Exam attempt not found", 404));
  }

  // Verify that the attempt belongs to this user
  if (attempt.userId.toString() !== userId.toString()) {
    return next(new AppError("Unauthorized access to this attempt", 403));
  }

  // Check if the attempt is still in progress or timed-out (both can be submitted)
  if (attempt.status !== "in-progress" && attempt.status !== "timed-out") {
    return next(
      new AppError(
        `This exam attempt is already ${attempt.status}. Cannot submit again.`,
        400
      )
    );
  }

  // Get exam details - use cache for frequently accessed exams
  let exam;
  try {
    exam = await examService.getExam(attempt.examId.toString());
    if (!exam) {
      exam = await Exam.findById(attempt.examId)
        .select(
          "totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue"
        )
        .lean();

      if (exam) {
        // Cache for future requests
        await examService.setExam(attempt.examId.toString(), exam);
      }
    }
  } catch (error) {
    console.error("Error fetching exam from cache:", error);
    exam = await Exam.findById(attempt.examId)
      .select(
        "totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue"
      )
      .lean();
  }

  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Use a unique write lock key to prevent concurrent evaluation of the same attempt
  const lockKey = `lock:attempt:${attemptId}`;
  let lockAcquired = false;

  try {
    // Try to acquire lock with exponential backoff (3 attempts)
    for (let attempt = 1; attempt <= 3 && !lockAcquired; attempt++) {
      try {
        // Set lock with 10 second expiry to prevent deadlocks
        lockAcquired = await examService.examCache.set(
          lockKey,
          Date.now(),
          "NX",
          "EX",
          10
        );

        if (!lockAcquired && attempt < 3) {
          // Wait with exponential backoff before retrying
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt - 1))
          );
        }
      } catch (error) {
        console.error(`Error acquiring lock (attempt ${attempt}/3):`, error);
      }
    }

    if (!lockAcquired) {
      // If we can't acquire lock after retries, inform user
      return next(
        new AppError(
          "System is currently processing your exam submission. Please try again in a few seconds.",
          429
        )
      );
    }

    // Use a MongoDB session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get all questions for evaluation - use cache first approach
      const questionIds = attempt.answers.map((a) => a.questionId.toString());

      // Try to get questions from cache first
      let questions = [];
      let questionMap = {};

      try {
        // Get question map from cache
        const cachedQuestions = await questionService.bulkGetExams(questionIds);

        if (cachedQuestions && cachedQuestions.length === questionIds.length) {
          // All questions found in cache
          questionMap = cachedQuestions.reduce((map, q) => {
            map[q.id] = q.data;
            return map;
          }, {});
          questions = cachedQuestions.map((q) => q.data);
        }
      } catch (error) {
        console.error("Error fetching questions from cache:", error);
      }

      // If cache miss, fetch from database
      if (questions.length !== questionIds.length) {
        questions = await Question.find({ _id: { $in: questionIds } })
          .select("options type marks hasNegativeMarking negativeMarks") // Only fetch fields we need
          .lean();

        // Build map for quick access
        questionMap = questions.reduce((map, q) => {
          map[q._id.toString()] = q;
          return map;
        }, {});

        // Cache questions for future requests in background
        setTimeout(() => {
          const questionDataToCache = questions.map((q) => ({
            id: q._id.toString(),
            data: q,
          }));
          questionService
            .bulkSetExams(questionDataToCache)
            .catch(console.error);
        }, 0);
      }

      // Calculate results
      let totalMarks = 0;
      let totalNegativeMarks = 0;
      let correctAnswers = 0;
      let wrongAnswers = 0;

      // Create a new answers array with evaluation results
      const evaluatedAnswers = [];

      // Evaluate each answer
      for (const answer of attempt.answers) {
        const question = questionMap[answer.questionId.toString()];

        // Create a base evaluated answer
        const evaluatedAnswer = {
          questionId: answer.questionId,
          selectedOption: answer.selectedOption,
          isCorrect: null,
          marksEarned: 0,
          negativeMarks: 0,
          responseTime: answer.responseTime || 0,
        };

        if (!question) {
          // Skip if question not found
          evaluatedAnswers.push(evaluatedAnswer);
          continue;
        }

        // Skip evaluation if no answer selected
        if (answer.selectedOption === null) {
          evaluatedAnswers.push(evaluatedAnswer);
          continue;
        }

        // Evaluate based on question type
        let isCorrect = false;

        if (question.type === "MCQ" || question.type === "STATEMENT_BASED") {
          // For MCQ, find the correct option
          const correctOption = question.options.find((o) => o.isCorrect);
          if (correctOption) {
            isCorrect =
              answer.selectedOption.toString() === correctOption._id.toString();
          }
        }

        // Update evaluated answer
        evaluatedAnswer.isCorrect = isCorrect;

        if (isCorrect) {
          evaluatedAnswer.marksEarned = question.marks || 1;
          totalMarks += evaluatedAnswer.marksEarned;
          correctAnswers++;
        } else {
          // Apply negative marking if enabled
          if (exam.hasNegativeMarking && question.hasNegativeMarking) {
            const negMarks =
              question.negativeMarks || exam.negativeMarkingValue || 0;
            evaluatedAnswer.negativeMarks = negMarks;
            totalNegativeMarks += negMarks;
          }
          wrongAnswers++;
        }

        evaluatedAnswers.push(evaluatedAnswer);
      }

      // Calculate final score
      const finalScore = Math.max(0, totalMarks - totalNegativeMarks);

      // Determine if passed based on pass mark percentage
      const passMark = (exam.totalMarks * exam.passMarkPercentage) / 100;
      const hasPassed = finalScore >= passMark;
      const unattempted =
        attempt.answers.length - (correctAnswers + wrongAnswers);

      // Create submission result for database update
      const submissionResult = {
        totalMarks,
        negativeMarks: totalNegativeMarks,
        finalScore,
        correctAnswers,
        wrongAnswers,
        unattempted,
        hasPassed,
        status: "completed",
        endTime: new Date(),
        answers: evaluatedAnswers,
      };

      // Update the attempt in the database with findOneAndUpdate for better concurrency
      // This is more efficient than loading the full document, modifying it, and saving
      const updatedAttempt = await ExamAttempt.findOneAndUpdate(
        {
          _id: attemptId,
          userId: userId,
          status: { $in: ["in-progress", "timed-out"] }, // Ensure it's still in a valid state
        },
        { $set: submissionResult },
        { new: true, session, runValidators: false }
      );

      if (!updatedAttempt) {
        throw new Error(
          "Failed to update attempt - it may have been modified by another process"
        );
      }

      // Queue analytics update to be processed in batches
      await analyticsService.queueAnalyticsUpdate(exam._id.toString(), {
        attempted: true,
        completed: true,
        passed: hasPassed,
        failed: !hasPassed,
        score: finalScore,
      });

      // Increment counters directly in Redis for immediate consistency
      await attemptService.incrementAttemptCount(exam._id.toString());

      // Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // Create result payload for client
      const resultPayload = {
        attemptId: updatedAttempt._id,
        totalMarks,
        negativeMarks: totalNegativeMarks,
        finalScore,
        correctAnswers,
        wrongAnswers,
        unattempted,
        hasPassed,
        passMarkPercentage: exam.passMarkPercentage,
        passMark,
        totalQuestions: attempt.answers.length,
        scorePercentage: (finalScore / exam.totalMarks) * 100,
      };

      // Cache result for future lookups
      await attemptService.setAttempt(
        attemptId,
        {
          ...resultPayload,
          userId: userId.toString(),
          examId: exam._id.toString(),
          status: "completed",
        },
        30 * 60
      ); // Cache for 30 minutes

      // Return results to the client
      res.status(200).json({
        status: "success",
        data: resultPayload,
      });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      console.error("Error submitting exam:", error);
      return next(new AppError("Failed to submit exam: " + error.message, 500));
    } finally {
      // Always release the lock
      try {
        await examService.examCache.del(lockKey);
      } catch (error) {
        console.error("Error releasing lock:", error);
      }
    }
  } catch (error) {
    console.error("Error in lock handling:", error);
    return next(new AppError("Failed to process exam submission", 500));
  }
});

export default submitExam;
