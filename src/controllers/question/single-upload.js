// src/controllers/question/single-upload.js
import Question from "../../models/questions.models.js";
import { AppError, catchAsync } from "../../utils/errorHandler.js";
import { checkExamExists, getUserId } from "../../utils/cachedDbQueries.js";
import { questionService } from "../../services/redisService.js";
import {
  difficultyLevel as validDifficultyLevel,
  questionTypes,
} from "../../utils/arrays.js";

const uploadSingleQuestion = catchAsync(async (req, res, next) => {
  const {
    examId,
    questionText,
    type,
    options = [],
    statements = [],
    statementInstruction = "",
    marks = 1,
    difficultyLevel = "MEDIUM",
    subject = "",
    hasNegativeMarking = false,
    negativeMarks = 0,
    explanation = "",
    image = "",
    correctAnswer = "",
    questionCode = "",
  } = req.body;

  // Validate required fields
  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  if (!questionText) {
    return next(new AppError("Question text is required", 400));
  }

  if (!type) {
    return next(new AppError("Question type is required", 400));
  }

  // Validate marks
  if (!marks || parseInt(marks, 10) < 1) {
    return next(new AppError("Valid marks value is required (minimum 1)", 400));
  }

  if (difficultyLevel && !validDifficultyLevel.includes(difficultyLevel)) {
    return next(
      new AppError(
        `Invalid difficulty level. Must be one of: ${validDifficultyLevel.join(
          ", "
        )}`,
        400
      )
    );
  }

  // Validate negative marks
  if (
    hasNegativeMarking &&
    (negativeMarks === undefined || isNaN(parseFloat(negativeMarks)))
  ) {
    return next(
      new AppError(
        "Negative marks value is required when negative marking is enabled",
        400
      )
    );
  }

  // Validate subject is provided
  if (subject === undefined) {
    return next(new AppError("Subject field is required", 400));
  }

  // Ensure statements are provided for STATEMENT_BASED questions
  if (
    type === "STATEMENT_BASED" &&
    (!statements || !Array.isArray(statements) || statements.length === 0)
  ) {
    return next(
      new AppError("Statements are required for STATEMENT_BASED questions", 400)
    );
  }

  // Ensure statement instruction is provided for STATEMENT_BASED questions
  if (type === "STATEMENT_BASED" && !statementInstruction) {
    return next(
      new AppError(
        "Statement instruction is required for STATEMENT_BASED questions",
        400
      )
    );
  }

  if (!questionTypes.includes(type)) {
    return next(
      new AppError(
        `Invalid question type. Must be one of: ${questionTypes.join(", ")}`,
        400
      )
    );
  }

  // Validate options for question types that require them
  const requiresOptions = ["MCQ"];
  if (requiresOptions.includes(type) && (!options || options.length === 0)) {
    return next(
      new AppError(`Options are required for ${type} question type`, 400)
    );
  }

  // Check if exam exists using cached lookup for efficiency
  const examExists = await checkExamExists(examId);
  if (!examExists) {
    return next(new AppError("Exam not found", 404));
  }

  // Get user ID efficiently with caching
  const clerkId = req.user.sub;
  const userId = await getUserId(clerkId);

  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Prepare the question document
  const questionData = {
    examId,
    questionText,
    type,
    marks: parseInt(marks, 10),
    difficultyLevel,
    subject,
    options,
    statements,
    statementInstruction,
    hasNegativeMarking:
      hasNegativeMarking === "true" || hasNegativeMarking === true,
    negativeMarks: parseFloat(negativeMarks),
    explanation,
    image,
    correctAnswer: typeof correctAnswer === "string" ? correctAnswer : "",
    isActive: true,
    createdBy: userId,
    questionCode,
  };

  try {
    // Create the question
    const newQuestion = await Question.create(questionData);

    // Cache the new question
    await questionService.setQuestion(
      newQuestion._id.toString(),
      newQuestion.toJSON()
    );

    // Invalidate the questions by exam cache for this examId
    await questionService.deleteQuestionsByExam(examId);

    // Send response
    res.status(201).json({
      status: "success",
      message: "Question created successfully",
      data: {
        question: newQuestion,
      },
    });
  } catch (error) {
    // Handle validation errors
    if (error.name === "ValidationError") {
      return next(new AppError(`Validation error: ${error.message}`, 400));
    } else if (error.name === "MongoServerError" && error.code === 11000) {
      return next(new AppError(`Duplicate entry found: ${error.message}`, 400));
    }

    return next(new AppError(error.message, 500));
  }
});

export default uploadSingleQuestion;
