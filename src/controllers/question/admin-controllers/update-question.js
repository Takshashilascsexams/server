import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { questionService } from "../../../services/redisService.js";
import { questionTypes, difficultyLevel } from "../../../utils/arrays.js";

/**
 * Update an existing question
 */
const updateQuestion = catchAsync(async (req, res, next) => {
  const { questionId } = req.params;

  if (!questionId) {
    return next(new AppError("Question ID is required", 400));
  }

  // Validate required fields
  const {
    questionText,
    type,
    difficultyLevel: difficulty, // Fixed field name consistency
    subject, // Changed from 'category' to match model
    marks,
    hasNegativeMarking, // Added missing field
    negativeMarks,
    options,
    statements,
    statementInstruction,
    explanation,
    correctAnswer, // Added missing field
    image, // Added missing field
    questionCode, // Added missing field
  } = req.body;

  // Basic validation
  if (!questionText) {
    return next(new AppError("Question text is required", 400));
  }

  if (!type || !questionTypes.includes(type)) {
    return next(
      new AppError(
        `Question type must be one of: ${questionTypes.join(", ")}`,
        400
      )
    );
  }

  // Validate difficulty level if provided
  if (difficulty && !difficultyLevel.includes(difficulty)) {
    return next(
      new AppError(
        `Difficulty level must be one of: ${difficultyLevel.join(", ")}`,
        400
      )
    );
  }

  // Validate options for MCQ questions
  if (
    type === "MCQ" &&
    (!options || !Array.isArray(options) || options.length < 2)
  ) {
    return next(
      new AppError("MCQ questions must have at least 2 options", 400)
    );
  }

  // Ensure at least one option is marked as correct for MCQs
  if (
    type === "MCQ" &&
    options &&
    !options.some((option) => option.isCorrect)
  ) {
    return next(
      new AppError("At least one option must be marked as correct", 400)
    );
  }

  // Validate statements for STATEMENT_BASED questions
  if (
    type === "STATEMENT_BASED" &&
    (!statements || !Array.isArray(statements) || statements.length < 2)
  ) {
    return next(
      new AppError(
        "Statement-based questions must have at least 2 statements",
        400
      )
    );
  }

  // Validate that at least one statement is marked as correct for STATEMENT_BASED questions
  if (
    type === "STATEMENT_BASED" &&
    statements &&
    !statements.some((statement) => statement.isCorrect)
  ) {
    return next(
      new AppError("At least one statement must be marked as correct", 400)
    );
  }

  // Validate statement instructions for STATEMENT_BASED questions
  if (type === "STATEMENT_BASED" && !statementInstruction) {
    return next(
      new AppError(
        "Statement instructions are required for statement-based questions",
        400
      )
    );
  }

  // Transform form values to API expected format - matching model fields exactly
  const questionData = {
    questionText,
    type,
    difficultyLevel: difficulty || "MEDIUM",
    subject: subject || "", // Changed from 'category' to 'subject'
    marks: parseInt(marks || 1, 10),
    hasNegativeMarking: hasNegativeMarking === "Yes" ? true : false, // Added missing field
    negativeMarks: parseFloat(negativeMarks || 0),
    options: options || [],
    explanation: explanation || "",
    correctAnswer: correctAnswer || "", // Added missing field
    image: image || "", // Added missing field
    questionCode: questionCode || "", // Added missing field
  };

  // Add statement-specific fields if needed
  if (type === "STATEMENT_BASED") {
    questionData.statements = statements;
    questionData.statementInstruction = statementInstruction;
  } else {
    // If converting from STATEMENT_BASED to another type, use proper Mongoose unset approach
    questionData.statements = undefined;
    questionData.statementInstruction = undefined;
  }

  try {
    // Find and update the question
    const updatedQuestion = await Question.findByIdAndUpdate(
      questionId,
      questionData,
      {
        new: true, // Return the updated document
        runValidators: true, // Run validators on update
      }
    );

    if (!updatedQuestion) {
      return next(new AppError("Question not found", 404));
    }

    // Get the examId for cache invalidation
    const examId = updatedQuestion.examId;

    // Update the question in cache
    await questionService.setQuestion(
      questionId,
      updatedQuestion.toJSON(),
      3600
    );

    // Invalidate questions by exam cache
    await questionService.clearExamQuestionsCache(examId);

    // Invalidate dashboard question cache
    await questionService.clearDashboardCache();

    // Send response
    res.status(200).json({
      status: "success",
      message: "Question updated successfully",
      data: {
        question: updatedQuestion,
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

export default updateQuestion;
