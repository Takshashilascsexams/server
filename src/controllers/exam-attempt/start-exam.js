import ExamAttempt from "../../models/examAttempt.models.js";
import Exam from "../../models/exam.models.js";
import Question from "../../models/questions.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import checkExamAccess from "../payment/check-access.js";
import { examService, questionService } from "../../services/redisService.js";

/**
 * Controller to start a new exam attempt
 * 1. Validates if user has access to the exam
 * 2. Checks if there are any existing in-progress attempts
 * 3. Creates a new attempt record
 * 4. Returns exam details with shuffled questions and options
 */
const startExam = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Check if exam exists (use cache if available)
  let exam;
  try {
    const cachedExam = await examService.getExam(examId);
    if (cachedExam) {
      exam = cachedExam;
    } else {
      exam = await Exam.findById(examId);
      if (!exam) {
        return next(new AppError("Exam not found", 404));
      }
      // Cache the exam for future requests
      await examService.setExam(examId, exam);
    }
  } catch (error) {
    console.error("Error fetching exam:", error);
    exam = await Exam.findById(examId);
    if (!exam) {
      return next(new AppError("Exam not found", 404));
    }
  }

  // Check if exam is active
  if (!exam.isActive) {
    return next(new AppError("This exam is not currently active", 400));
  }

  // Check if user has access to the exam (for premium exams)
  if (exam.isPremium) {
    // Use existing check-access controller
    req.params = { examId };
    const access = await checkExamAccess(req, {}, (error) => {
      if (error) return next(error);
    });

    if (!access.data.hasAccess) {
      return next(
        new AppError("You don't have access to this premium exam", 403)
      );
    }
  }

  // Check if there's an existing in-progress attempt
  const existingAttempt = await ExamAttempt.findOne({
    userId,
    examId,
    status: "in-progress",
  });

  if (existingAttempt) {
    return res.status(200).json({
      status: "success",
      message: "Continuing existing attempt",
      data: {
        attemptId: existingAttempt._id,
        timeRemaining: existingAttempt.timeRemaining || exam.duration * 60, // in seconds
        resuming: true,
      },
    });
  }

  // Get questions for the exam (use cache if available)
  let questions;
  try {
    questions = await questionService.getQuestionsByExam(examId);
    if (!questions) {
      questions = await Question.find({ examId, isActive: true })
        .select(
          "questionText type options statements statementInstruction marks hasNegativeMarking negativeMarks"
        )
        .lean();
      // Cache the questions for future requests
      await questionService.setQuestionsByExam(examId, questions);
    }
  } catch (error) {
    console.error("Error fetching questions:", error);
    questions = await Question.find({ examId, isActive: true })
      .select(
        "questionText type options statements statementInstruction marks hasNegativeMarking negativeMarks"
      )
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

  // Select random questions up to totalQuestions if we have more than needed
  let selectedQuestions = questions;
  if (questions.length > exam.totalQuestions) {
    selectedQuestions = [];
    const questionIndices = new Set();

    // Create a random set of indices
    while (questionIndices.size < exam.totalQuestions) {
      const randomIndex = Math.floor(Math.random() * questions.length);
      questionIndices.add(randomIndex);
    }

    // Select questions based on the random indices
    questionIndices.forEach((index) => {
      selectedQuestions.push(questions[index]);
    });
  }

  // Shuffle the selected questions
  selectedQuestions = selectedQuestions.sort(() => Math.random() - 0.5);

  // Create a new attempt record
  const newAttempt = await ExamAttempt.create({
    userId,
    examId,
    startTime: new Date(),
    status: "in-progress",
    timeRemaining: exam.duration * 60, // Convert minutes to seconds
    answers: selectedQuestions.map((q) => ({
      questionId: q._id,
      selectedOption: null,
      isCorrect: null,
      marksEarned: 0,
      negativeMarks: 0,
    })),
    unattempted: selectedQuestions.length,
  });

  // Return minimal information to start the exam
  res.status(201).json({
    status: "success",
    data: {
      attemptId: newAttempt._id,
      timeRemaining: exam.duration * 60, // in seconds
      resuming: false,
    },
  });
});

export default startExam;
