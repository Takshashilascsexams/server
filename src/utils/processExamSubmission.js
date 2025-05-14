// Helper function to process exam submission
// This could be moved to a separate worker in a production environment
import Question from "../models/questions.models.js";
import ExamAttempt from "../models/examAttempt.models.js";
import { analyticsService, attemptService } from "../services/redisService.js";

export const processExamSubmission = async (
  attemptId,
  attempt,
  exam,
  session
) => {
  // Get question IDs from attempt
  const questionIds = attempt.answers.map((a) => a.questionId.toString());

  // Fetch questions from database or cache
  const questions = await Question.find({ _id: { $in: questionIds } })
    .select(
      "_id options type marks hasNegativeMarking negativeMarks correctAnswer"
    )
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
      // Find correct option by matching with the correctAnswer text
      const correctOption = question.options.find(
        (o) => o.optionText === question.correctAnswer
      );

      if (correctOption) {
        isCorrect =
          answer.selectedOption.toString() === correctOption._id.toString();
      }
    } else if (question.type === "MULTIPLE_SELECT") {
      // For multiple select, use the isCorrect flag on options
      if (Array.isArray(answer.selectedOption)) {
        const correctOptions = question.options
          .filter((o) => o.isCorrect)
          .map((o) => o._id.toString());

        isCorrect =
          correctOptions.length === answer.selectedOption.length &&
          correctOptions.every((id) => answer.selectedOption.includes(id));
      }
    } else if (question.type === "TRUE_FALSE") {
      // For true/false, find option matching correctAnswer text
      const correctOption = question.options.find(
        (o) =>
          o.optionText.toLowerCase() === question.correctAnswer.toLowerCase()
      );

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
    timeRemaining:
      attempt.status === "timed-out" ? 0 : attempt.currentTimeRemaining || 0,
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

  try {
    // Use your attemptService's setAttemptTimer method
    await attemptService.setAttemptTimer(
      attemptId,
      {
        timeRemaining: 0,
        absoluteEndTime: Date.now(), // End time is now
        lastSyncTime: Date.now(),
        completed: true,
      },
      300 // Keep for 5 minutes as reference
    );
  } catch (redisError) {
    console.log(
      "Non-critical error updating Redis timer on submission:",
      redisError
    );
    // Non-critical error, continue processing
  }

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
