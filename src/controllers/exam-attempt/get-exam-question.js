import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { questionService } from "../../services/redisService.js";

/**
 * Controller to fetch questions for an active exam attempt
 * - Returns questions without the correct answers
 * - Includes user's saved answers if any
 * - Maintains the same order as the attempt was created with
 */

const getExamQuestions = catchAsync(async (req, res, next) => {
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

  // Check if the attempt is still in progress
  if (attempt.status !== "in-progress") {
    return next(
      new AppError(
        `This exam attempt is already ${attempt.status}. You cannot continue.`,
        400
      )
    );
  }

  // Get the exam details
  const exam = await Exam.findById(attempt.examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get the questions based on the questionIds in the attempt
  const questionIds = attempt.answers.map((a) => a.questionId);

  // Try to get questions from cache first
  let questions = [];
  let questionMap = {};

  try {
    // Build a map of questionId to question details for all questions in the exam
    const allQuestions = await questionService.getQuestionsByExam(
      attempt.examId.toString()
    );

    if (allQuestions && Array.isArray(allQuestions)) {
      questionMap = allQuestions.reduce((map, q) => {
        if (q && q._id) {
          map[q._id.toString()] = q;
        }
        return map;
      }, {});

      // Select only the questions that are in this attempt
      questions = questionIds
        .map((qId) => questionMap[qId.toString()])
        .filter(Boolean);
    }
  } catch (error) {
    console.error("Error fetching questions from cache:", error);
  }

  // If we couldn't get questions from cache, fetch from database
  if (questions.length !== questionIds.length) {
    questions = await Question.find({ _id: { $in: questionIds } }).lean();

    // Cache individual questions for future requests
    for (const q of questions) {
      if (q && q._id) {
        await questionService.setQuestion(q._id.toString(), q);
      }
    }
  }

  if (!questions || questions.length === 0) {
    return next(new AppError("No questions found for this exam attempt", 404));
  }

  // Prepare questions for client-side rendering
  // - Remove correct answer information
  // - Add user's saved answers
  const preparedQuestions = [];

  for (let i = 0; i < attempt.answers.length; i++) {
    const answer = attempt.answers[i];
    if (!answer || !answer.questionId) continue;

    const question = questions.find(
      (q) => q && q._id && q._id.toString() === answer.questionId.toString()
    );

    if (question) {
      // Create a clean version of the question without revealing the correct answers
      const cleanQuestion = {
        id: question._id,
        questionText: question.questionText,
        type: question.type,
        marks: question.marks,
        responseTime: answer.responseTime || 0,
        selectedOption: answer.selectedOption,
      };

      // Safely handle options for MCQ type
      if (question.options && Array.isArray(question.options)) {
        cleanQuestion.options = question.options.map((opt) => ({
          _id: opt._id,
          optionText: opt.optionText,
        }));
      } else {
        cleanQuestion.options = [];
      }

      // Add statement-related fields for STATEMENT_BASED questions
      if (
        question.type === "STATEMENT_BASED" &&
        question.statements &&
        Array.isArray(question.statements)
      ) {
        cleanQuestion.statements = question.statements.map((stmt) => ({
          statementNumber: stmt.statementNumber,
          statementText: stmt.statementText,
        }));
        cleanQuestion.statementInstruction = question.statementInstruction;
      }

      preparedQuestions.push(cleanQuestion);
    }
  }

  // Get the exam details to return to the client
  const examDetails = {
    title: exam.title,
    description: exam.description,
    duration: exam.duration,
    totalQuestions: exam.totalQuestions,
    totalMarks: exam.totalMarks,
    passMarkPercentage: exam.passMarkPercentage,
    hasNegativeMarking: exam.hasNegativeMarking,
    negativeMarkingValue: exam.negativeMarkingValue,
    allowNavigation: exam.allowNavigation,
  };

  res.status(200).json({
    status: "success",
    data: {
      attempt: {
        id: attempt._id,
        timeRemaining: attempt.timeRemaining,
        status: attempt.status,
      },
      exam: examDetails,
      questions: preparedQuestions,
    },
  });
});

export default getExamQuestions;
