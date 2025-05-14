import ExamAttempt from "../../../models/examAttempt.models.js";
import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  questionService,
  examService,
  attemptService,
} from "../../../services/redisService.js";

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

  // Get the exam details - use cached version
  const exam = await examService.getExam(attempt.examId.toString());
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get the questionIds from the attempt
  const questionIds = attempt.answers.map((a) => a.questionId.toString());

  // Use the improved batch function to get questions from cache
  let questionResults = await attemptService.batchGetQuestionsForAttempt(
    attemptId
  );

  // If not in cache, fetch from database and cache them
  if (!questionResults || questionResults.length !== questionIds.length) {
    // Fetch questions from database
    const questions = await Question.find({ _id: { $in: questionIds } })
      .select("questionText type options statements statementInstruction marks")
      .lean();

    // Prefetch for future requests
    await questionService.prefetchQuestionsForAttempt(attemptId, questionIds);

    // Map questions to the expected format
    questionResults = questions.map((q) => ({
      id: q._id.toString(),
      data: q,
    }));
  }

  if (!questionResults || questionResults.length === 0) {
    return next(new AppError("No questions found for this exam attempt", 404));
  }

  // Create a map for faster lookup
  const questionMap = questionResults.reduce((map, item) => {
    map[item.id] = item.data;
    return map;
  }, {});

  // Prepare questions for client-side rendering
  const preparedQuestions = [];

  for (let i = 0; i < attempt.answers.length; i++) {
    const answer = attempt.answers[i];
    if (!answer || !answer.questionId) continue;

    const questionId = answer.questionId.toString();
    const question = questionMap[questionId];

    if (question) {
      // Create a clean version of the question without revealing the correct answers
      const cleanQuestion = {
        id: question._id || questionId,
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

  // Cache the prepared questions for future requests
  try {
    await examService.setPreparedQuestions(
      attemptId,
      preparedQuestions,
      examDetails
    );
  } catch (error) {
    console.error(
      `Error caching prepared questions for attempt ${attemptId}:`,
      error
    );
  }

  res.status(200).json({
    status: "success",
    data: {
      attempt: {
        id: attempt._id,
        timeRemaining: attempt.timeRemaining,
        status: attempt.status,
        serverTime: Date.now(), // Add server time
      },
      exam: examDetails,
      questions: preparedQuestions,
    },
  });
});

export default getExamQuestions;
