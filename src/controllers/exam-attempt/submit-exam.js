import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import ExamAnalytics from "../../models/examAnalytics.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { examService, analyticsService } from "../../services/redisService.js";
import mongoose from "mongoose";

/**
 * Controller to submit an exam and calculate results
 * - Evaluates all answers
 * - Calculates scores including negative marking
 * - Updates attempt status
 * - Updates exam analytics
 */
const submitExam = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Find the exam attempt
  const attempt = await ExamAttempt.findById(attemptId);
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

  // Get exam details
  const exam = await Exam.findById(attempt.examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Use a MongoDB session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Get all questions for evaluation
    const questionIds = attempt.answers.map((a) => a.questionId);
    const questions = await Question.find({ _id: { $in: questionIds } }).lean();

    // Create a map for quick access to questions by ID
    const questionMap = {};
    questions.forEach((q) => {
      questionMap[q._id.toString()] = q;
    });

    // Calculate results
    let totalMarks = 0;
    let totalNegativeMarks = 0;
    let correctAnswers = 0;
    let wrongAnswers = 0;

    // Evaluate each answer
    for (const answer of attempt.answers) {
      const question = questionMap[answer.questionId.toString()];

      if (!question) continue; // Skip if question not found

      // Skip evaluation if no answer selected
      if (answer.selectedOption === null) continue;

      // Evaluate based on question type
      let isCorrect = false;

      if (question.type === "MCQ") {
        // For MCQ, find the correct option
        const correctOption = question.options.find((o) => o.isCorrect);
        if (correctOption) {
          isCorrect =
            answer.selectedOption.toString() === correctOption._id.toString();
        }
      } else if (question.type === "STATEMENT_BASED") {
        // For statement-based, the correct option is marked in the options array
        const correctOption = question.options.find((o) => o.isCorrect);
        if (correctOption) {
          isCorrect =
            answer.selectedOption.toString() === correctOption._id.toString();
        }
      }

      // Update answer
      answer.isCorrect = isCorrect;

      if (isCorrect) {
        answer.marksEarned = question.marks || 1;
        totalMarks += answer.marksEarned;
        correctAnswers++;
      } else {
        answer.marksEarned = 0;
        // Apply negative marking if enabled
        if (exam.hasNegativeMarking && question.hasNegativeMarking) {
          const negMarks =
            question.negativeMarks || exam.negativeMarkingValue || 0;
          answer.negativeMarks = negMarks;
          totalNegativeMarks += negMarks;
        }
        wrongAnswers++;
      }
    }

    // Calculate final score
    const finalScore = Math.max(0, totalMarks - totalNegativeMarks);

    // Determine if passed based on pass mark percentage
    const passMark = (exam.totalMarks * exam.passMarkPercentage) / 100;
    const hasPassed = finalScore >= passMark;

    // Update attempt with results
    attempt.totalMarks = totalMarks;
    attempt.negativeMarks = totalNegativeMarks;
    attempt.finalScore = finalScore;
    attempt.correctAnswers = correctAnswers;
    attempt.wrongAnswers = wrongAnswers;
    attempt.unattempted =
      attempt.answers.length - (correctAnswers + wrongAnswers);
    attempt.hasPassed = hasPassed;
    attempt.status = "completed";
    attempt.endTime = new Date();

    await attempt.save({ session });

    // Update exam analytics
    let analytics = await ExamAnalytics.findOne({ examId: exam._id });

    if (!analytics) {
      // Create new analytics if not found
      analytics = new ExamAnalytics({
        examId: exam._id,
        totalAttempted: 0,
        totalCompleted: 0,
        highestScore: 0,
        lowestScore: Number.MAX_SAFE_INTEGER,
        averageScore: 0,
        passCount: 0,
        failCount: 0,
        passPercentage: 0,
        failPercentage: 0,
      });
    }

    // Update analytics
    analytics.totalAttempted += 1;
    analytics.totalCompleted += 1;
    analytics.highestScore = Math.max(analytics.highestScore, finalScore);
    analytics.lowestScore = Math.min(analytics.lowestScore, finalScore);

    // Recalculate average - old average * old count + new score, divided by new count
    const oldAvgTotal = analytics.averageScore * (analytics.totalCompleted - 1);
    analytics.averageScore =
      (oldAvgTotal + finalScore) / analytics.totalCompleted;

    if (hasPassed) {
      analytics.passCount += 1;
    } else {
      analytics.failCount += 1;
    }

    analytics.passPercentage =
      (analytics.passCount / analytics.totalCompleted) * 100;
    analytics.failPercentage =
      (analytics.failCount / analytics.totalCompleted) * 100;

    await analytics.save({ session });

    // Cache updated analytics
    await analyticsService.setAnalytics(
      exam._id.toString(),
      analytics.toJSON()
    );

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    // Return results to the client
    res.status(200).json({
      status: "success",
      data: {
        attemptId: attempt._id,
        totalMarks,
        negativeMarks: totalNegativeMarks,
        finalScore,
        correctAnswers,
        wrongAnswers,
        unattempted: attempt.unattempted,
        hasPassed,
        passMarkPercentage: exam.passMarkPercentage,
        passMark,
        totalQuestions: attempt.answers.length,
        scorePercentage: (finalScore / exam.totalMarks) * 100,
      },
    });
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    session.endSession();
    console.error("Error submitting exam:", error);
    return next(new AppError("Failed to submit exam", 500));
  }
});

export default submitExam;
