// src/controllers/exam-attempt/get-exam-question.js
import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import {
  questionService,
  attemptService,
} from "../../services/redisService.js";
import { loadBalancer } from "../../utils/loadBalancer.js";

/**
 * Controller to fetch questions for an active exam attempt
 * - Optimized for high concurrency with efficient caching
 * - Returns questions without revealing answers
 * - Includes user's saved answers if any
 * - Maintains consistent question order throughout the exam
 */
const getExamQuestions = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;
  // Accept pagination for very large exams
  const { page, limit } = req.query;
  const pageNum = page ? parseInt(page) : null;
  const limitNum = limit ? parseInt(limit) : null;

  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Find the exam attempt with basic caching
  let attempt;
  const attemptCacheKey = `attempt:${attemptId}`;
  try {
    // Try cache first
    attempt = await attemptService.getAttempt(attemptCacheKey);

    if (!attempt) {
      // Cache miss, get from database
      attempt = await ExamAttempt.findById(attemptId).lean();

      if (attempt) {
        // Store in cache with a short TTL since attempt state changes frequently
        await attemptService.setAttempt(attemptCacheKey, attempt, 2 * 60); // 2 minutes TTL
      }
    }
  } catch (error) {
    console.error(`Cache error for attempt ${attemptId}:`, error);
    // Fallback to database on cache error
    attempt = await ExamAttempt.findById(attemptId).lean();
  }

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

  // Register this active session with the load balancer
  try {
    await loadBalancer.registerExamSession(attemptId, userId);
  } catch (error) {
    // Just log error but continue processing
    console.error(
      `Failed to register exam session for load balancing: ${error.message}`
    );
  }

  // Get the exam details (minimal fields needed)
  const exam = await Exam.findById(attempt.examId)
    .select(
      "title description duration totalQuestions totalMarks passMarkPercentage hasNegativeMarking negativeMarkingValue allowNavigation"
    )
    .lean();

  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get the questions based on the questionIds in the attempt
  const questionIds = attempt.answers.map((a) => a.questionId);

  // Apply pagination if requested
  let paginatedQuestionIds = questionIds;
  if (pageNum !== null && limitNum !== null) {
    const startIdx = (pageNum - 1) * limitNum;
    const endIdx = startIdx + limitNum;
    paginatedQuestionIds = questionIds.slice(startIdx, endIdx);
  }

  // Try to get questions from cache first with batch processing
  const questions = [];
  const questionFetchPromises = [];
  const questionsToFetchFromDb = [];

  // Build cache lookup promises for all questions
  for (const qId of paginatedQuestionIds) {
    const questionCacheKey = `question:${qId}`;
    questionFetchPromises.push(
      questionService
        .getQuestion(questionCacheKey)
        .then((cachedQuestion) => {
          if (cachedQuestion) {
            questions.push({ ...cachedQuestion, _id: qId });
          } else {
            questionsToFetchFromDb.push(qId);
          }
        })
        .catch((error) => {
          console.error(
            `Error fetching question ${qId} from cache: ${error.message}`
          );
          questionsToFetchFromDb.push(qId);
        })
    );
  }

  // Wait for all cache lookups to complete
  await Promise.all(questionFetchPromises);

  // If we have questions to fetch from DB, do it in a single query
  if (questionsToFetchFromDb.length > 0) {
    const dbQuestions = await Question.find({
      _id: { $in: questionsToFetchFromDb },
    }).lean();

    // Cache these questions for future requests
    for (const question of dbQuestions) {
      questions.push(question);

      // Cache in background (don't wait)
      questionService
        .setQuestion(`question:${question._id}`, question, 60 * 60) // 1 hour TTL
        .catch((error) =>
          console.error(
            `Error caching question ${question._id}: ${error.message}`
          )
        );
    }
  }

  if (questions.length === 0) {
    return next(new AppError("No questions found for this exam attempt", 404));
  }

  // Create a map from questionId to attempt answer for efficient lookup
  const answerMap = {};
  for (const answer of attempt.answers) {
    answerMap[answer.questionId.toString()] = answer;
  }

  // Prepare questions for client-side rendering
  // - Remove correct answer information
  // - Add user's saved answers
  const preparedQuestions = [];

  for (const question of questions) {
    const answer = answerMap[question._id.toString()];
    if (!answer) continue; // Skip if no matching answer in attempt

    // Create a clean version without revealing correct answers
    const cleanQuestion = {
      id: question._id,
      questionText: question.questionText,
      type: question.type,
      marks: question.marks,
      responseTime: answer.responseTime || 0,
      selectedOption: answer.selectedOption,

      // For MCQ type, remove isCorrect flag from options
      options: question.options.map((opt) => ({
        _id: opt._id,
        optionText: opt.optionText,
      })),
    };

    // Add statement-related fields for STATEMENT_BASED questions
    if (question.type === "STATEMENT_BASED" && question.statements) {
      cleanQuestion.statements = question.statements.map((stmt) => ({
        statementNumber: stmt.statementNumber,
        statementText: stmt.statementText,
      }));
      cleanQuestion.statementInstruction = question.statementInstruction;
    }

    preparedQuestions.push(cleanQuestion);
  }

  // Sort questions to match the order in the attempt
  if (pageNum === null) {
    // If not paginated, sort all questions
    preparedQuestions.sort((a, b) => {
      const indexA = questionIds.findIndex(
        (id) => id.toString() === a.id.toString()
      );
      const indexB = questionIds.findIndex(
        (id) => id.toString() === b.id.toString()
      );
      return indexA - indexB;
    });
  }

  // Get minimal exam details to return
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

  // Calculate time data
  const currentTime = new Date();
  const startTime = new Date(attempt.startTime);
  const elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
  const timeRemaining = Math.max(0, exam.duration * 60 - elapsedSeconds);

  // Include pagination info if applicable
  const pagination =
    pageNum !== null
      ? {
          page: pageNum,
          limit: limitNum,
          total: questionIds.length,
          totalPages: Math.ceil(questionIds.length / limitNum),
        }
      : null;

  res.status(200).json({
    status: "success",
    data: {
      attempt: {
        id: attempt._id,
        timeRemaining: attempt.timeRemaining || timeRemaining,
        status: attempt.status,
      },
      exam: examDetails,
      questions: preparedQuestions,
      pagination,
    },
  });
});

export default getExamQuestions;
