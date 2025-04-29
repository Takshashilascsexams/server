import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";

/**
 * Controller to get detailed results of a completed attempt
 * - Returns full analysis including correct answers
 * - Shows detailed breakdown by question
 * - Includes all answer explanations
 */
const getAttemptResult = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Find the exam attempt with populated exam
  const attempt = await ExamAttempt.findById(attemptId).populate("examId");
  if (!attempt) {
    return next(new AppError("Exam attempt not found", 404));
  }

  // Verify that the attempt belongs to this user
  if (attempt.userId.toString() !== userId.toString()) {
    return next(new AppError("Unauthorized access to this attempt", 403));
  }

  // For security, only allow viewing results of completed attempts
  if (attempt.status !== "completed" && attempt.status !== "timed-out") {
    return next(
      new AppError(
        `Results are only available for completed attempts. Current status: ${attempt.status}`,
        400
      )
    );
  }

  // Get all questions with correct answers and explanations
  const questionIds = attempt.answers.map((a) => a.questionId);
  const questions = await Question.find({ _id: { $in: questionIds } }).lean();

  // Create a map for quick access to questions by ID
  const questionMap = {};
  questions.forEach((q) => {
    questionMap[q._id.toString()] = q;
  });

  // Prepare detailed result with explanation and correct answers
  const detailedAnswers = attempt.answers
    .map((answer) => {
      const question = questionMap[answer.questionId.toString()];
      if (!question) return null; // Skip if question not found

      // Find the correct option
      let correctOption = null;
      if (question.type === "MCQ" || question.type === "STATEMENT_BASED") {
        correctOption = question.options.find((o) => o.isCorrect);
      }

      return {
        questionId: answer.questionId,
        questionText: question.questionText,
        type: question.type,
        statements: question.statements,
        statementInstruction: question.statementInstruction,
        selectedOption: answer.selectedOption,
        correctOptionId: correctOption ? correctOption._id : null,
        isCorrect: answer.isCorrect,
        marksEarned: answer.marksEarned,
        negativeMarks: answer.negativeMarks,
        responseTime: answer.responseTime,
        options: question.options,
        explanation: question.explanation || "No explanation provided",
      };
    })
    .filter(Boolean); // Remove nulls

  // Get exam details
  const examDetails = {
    title: attempt.examId.title,
    description: attempt.examId.description,
    totalQuestions: attempt.examId.totalQuestions,
    totalMarks: attempt.examId.totalMarks,
    passMarkPercentage: attempt.examId.passMarkPercentage,
    hasNegativeMarking: attempt.examId.hasNegativeMarking,
    negativeMarkingValue: attempt.examId.negativeMarkingValue,
  };

  // Result summary
  const summary = {
    totalMarks: attempt.totalMarks,
    negativeMarks: attempt.negativeMarks,
    finalScore: attempt.finalScore,
    correctAnswers: attempt.correctAnswers,
    wrongAnswers: attempt.wrongAnswers,
    unattempted: attempt.unattempted,
    hasPassed: attempt.hasPassed,
    scorePercentage: (attempt.finalScore / attempt.examId.totalMarks) * 100,
    startTime: attempt.startTime,
    endTime: attempt.endTime,
    timeTaken: attempt.endTime
      ? Math.floor((attempt.endTime - attempt.startTime) / 1000)
      : attempt.examId.duration * 60 - attempt.timeRemaining,
    rank: attempt.rank,
    percentile: attempt.percentile,
  };

  res.status(200).json({
    status: "success",
    data: {
      attempt: {
        id: attempt._id,
        status: attempt.status,
      },
      exam: examDetails,
      summary,
      detailedAnswers,
    },
  });
});

export default getAttemptResult;
