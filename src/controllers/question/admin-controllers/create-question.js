import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { questionService } from "../../../services/redisService.js";
import { checkExamExists, getUserId } from "../../../utils/cachedDbQueries.js";
import { questionTypes, difficultyLevel } from "../../../utils/arrays.js";

/**
 * Create a new question
 */
const createQuestion = catchAsync(async (req, res, next) => {
  const {
    examId,
    questionText,
    type,
    difficultyLevel: difficulty,
    category,
    marks,
    hasNegativeMarking = false,
    negativeMarks = 0,
    options,
    statements,
    statementInstruction, // Singular form to match model
    explanation,
  } = req.body;

  // Validate required fields
  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

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

  // Validate at least one option is marked as correct for MCQs
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

  // Check if exam exists
  const examExists = await checkExamExists(examId);
  if (!examExists) {
    return next(new AppError("Exam not found", 404));
  }

  // Get user ID
  const clerkId = req.user.sub;
  const userId = await getUserId(clerkId);

  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Prepare question data
  const questionData = {
    examId,
    questionText,
    type,
    difficultyLevel: difficulty || "MEDIUM",
    category: category || "",
    marks: parseInt(marks || 1, 10),
    hasNegativeMarking: hasNegativeMarking === "Yes" ? true : false,
    negativeMarks: parseFloat(negativeMarks),
    options: options || [],
    explanation: explanation || "",
    isActive: true,
    createdBy: userId,
  };

  // Add statement-specific fields if needed
  if (type === "STATEMENT_BASED") {
    questionData.statements = statements;
    questionData.statementInstruction = statementInstruction;
  }

  try {
    // Create the question
    const newQuestion = await Question.create(questionData);

    // Cache the new question
    await questionService.setQuestion(
      newQuestion._id.toString(),
      newQuestion.toJSON(),
      3600
    );

    // Invalidate questions by exam cache for this examId
    await questionService.clearExamQuestionsCache(examId);

    // Update the question count for this exam
    try {
      const count = await Question.countDocuments({ examId });
      await questionService.updateExamQuestionCount(examId, count);
    } catch (countError) {
      console.error("Error updating question count:", countError);
      // Non-critical error, continue execution
    }

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

export default createQuestion;
