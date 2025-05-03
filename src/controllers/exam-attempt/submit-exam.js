import ExamAttempt from "../../models/examAttempt.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { analyticsService, examService } from "../../services/redisService.js";
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

    // First check if the submission is already in progress or completed
    // This is an optimization to avoid unnecessary processing
    const cacheKey = `submit:${attemptId}:status`;
    const submissionStatus = await examService.get(
      examService.examCache,
      cacheKey
    );

    if (submissionStatus === "completed") {
      // Already submitted and processed - return the cached result
      const resultKey = `submit:${attemptId}:result`;
      const cachedResult = await examService.get(
        examService.examCache,
        resultKey
      );

      if (cachedResult) {
        await examService.examCache.del(lockKey);
        return res.status(200).json(cachedResult);
      }
    } else if (submissionStatus === "processing") {
      // Submission in progress - ask client to poll
      await examService.examCache.del(lockKey);
      return res.status(202).json({
        status: "processing",
        message:
          "Your exam is being processed. Please check back in a few seconds.",
      });
    }

    // Mark submission as processing
    await examService.set(examService.examCache, cacheKey, "processing", 60);

    // Basic checks for attempt validity - lean query for efficiency
    const attempt = await ExamAttempt.findOne({
      _id: attemptId,
      userId,
      status: { $in: ["in-progress", "timed-out"] },
    })
      .select("examId answers status")
      .lean();

    if (!attempt) {
      await examService.examCache.del(lockKey);
      return next(
        new AppError("Exam attempt not found or already completed", 404)
      );
    }

    // Use transaction for data consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Get exam details from cache
      const exam = await examService.getExam(attempt.examId.toString());
      if (!exam) {
        throw new Error("Exam not found");
      }

      // Get all answers from cache first
      const answerCacheKey = `attempt:${attemptId}:answers`;
      const cachedAnswers = await examService.get(
        examService.examCache,
        answerCacheKey
      );

      // Process evaluation in the background
      // This simulates moving the heavy computation to a queue
      // In production, this would be a separate worker process
      const evaluationResult = await processExamSubmission(
        attemptId,
        attempt,
        exam,
        cachedAnswers,
        session
      );

      // Submit completed - cache result for future requests
      await examService.set(
        examService.examCache,
        `submit:${attemptId}:result`,
        {
          status: "success",
          data: evaluationResult,
        },
        30 * 60
      );

      // Update status to completed
      await examService.set(
        examService.examCache,
        cacheKey,
        "completed",
        30 * 60
      );

      // Clean up answer cache to save memory
      await examService.del(examService.examCache, answerCacheKey);

      // Release lock
      await examService.examCache.del(lockKey);

      // Return result to client
      return res.status(200).json({
        status: "success",
        data: evaluationResult,
      });
    } catch (error) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();

      // Update status to failed
      await examService.set(examService.examCache, cacheKey, "failed", 5 * 60);

      console.error("Error submitting exam:", error);

      // Release lock
      await examService.examCache.del(lockKey);

      return next(new AppError("Failed to submit exam: " + error.message, 500));
    }
  } catch (error) {
    // Release lock if any error occurred
    if (lockAcquired) {
      await examService.examCache.del(lockKey);
    }

    console.error("Error in exam submission:", error);
    return next(new AppError("Failed to process exam submission", 500));
  }
});

// Helper function to process exam submission
// This could be moved to a separate worker in a production environment
const processExamSubmission = async (
  attemptId,
  attempt,
  exam,
  cachedAnswers,
  session
) => {
  // Get question IDs from attempt
  const questionIds = attempt.answers.map((a) => a.questionId.toString());

  // Fetch questions from database or cache
  const questions = await Question.find({ _id: { $in: questionIds } })
    .select("_id options type marks hasNegativeMarking negativeMarks")
    .lean();

  // Build question map for quick lookup
  const questionMap = questions.reduce((map, q) => {
    map[q._id.toString()] = q;
    return map;
  }, {});

  // Calculate results
  let totalMarks = 0;
  let totalNegativeMarks = 0;
  let correctAnswers = 0;
  let wrongAnswers = 0;
  let unattempted = 0;

  // Evaluate each answer
  const evaluatedAnswers = attempt.answers.map((answer) => {
    const questionId = answer.questionId.toString();
    const question = questionMap[questionId];

    // Basic answer structure
    const evaluatedAnswer = {
      questionId: answer.questionId,
      selectedOption: answer.selectedOption,
      isCorrect: null,
      marksEarned: 0,
      negativeMarks: 0,
      responseTime: answer.responseTime || 0,
    };

    // Skip if question not found
    if (!question) {
      unattempted++;
      return evaluatedAnswer;
    }

    // Skip if no answer selected
    if (answer.selectedOption === null) {
      unattempted++;
      return evaluatedAnswer;
    }

    // Evaluate answer
    let isCorrect = false;

    if (question.type === "MCQ" || question.type === "STATEMENT_BASED") {
      // Find correct option
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

    return evaluatedAnswer;
  });

  // Calculate final score
  const finalScore = Math.max(0, totalMarks - totalNegativeMarks);

  // Determine if passed
  const passMark = (exam.totalMarks * exam.passMarkPercentage) / 100;
  const hasPassed = finalScore >= passMark;

  // Create submission result
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

  // Update the attempt in database
  await ExamAttempt.findOneAndUpdate(
    {
      _id: attemptId,
      status: { $in: ["in-progress", "timed-out"] },
    },
    { $set: submissionResult },
    { new: true, session }
  );

  // Queue analytics update
  await analyticsService.queueAnalyticsUpdate(exam._id.toString(), {
    attempted: true,
    completed: true,
    passed: hasPassed,
    failed: !hasPassed,
    score: finalScore,
  });

  // Return result payload
  return {
    attemptId,
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
};

export default submitExam;
