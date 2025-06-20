import multer from "multer";
import path from "path";
import fs from "fs/promises";
import Question from "../../../models/questions.models.js";
import mongoose from "mongoose";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import storage from "../../../utils/multerConfig.js";
import { checkExamExists, getUserId } from "../../../utils/cachedDbQueries.js";
import {
  questionService,
} from "../../../services/redisService.js";

// Configure file filter - only allow JSON files
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["application/json"];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only JSON files are allowed."), false);
  }
};

// Initialize multer with optimized settings for smaller batches
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit is enough for batches
});

// Process JSON document - optimized for smaller batches
const processJsonDocument = async (filePath) => {
  try {
    // Read the JSON file
    const jsonData = await fs.readFile(filePath, "utf8");

    // Parse the JSON content
    const questions = JSON.parse(jsonData);

    // Validate the JSON structure
    if (!Array.isArray(questions)) {
      throw new Error("Invalid JSON format. Expected an array of questions.");
    }

    // More efficient validation for smaller batches
    return questions.map((question, index) => {
      // Basic validation
      if (!question.questionText) {
        throw new Error(`Question at index ${index} is missing questionText.`);
      }

      if (!Array.isArray(question.options) || question.options.length < 2) {
        throw new Error(
          `Question at index ${index} has invalid options. Must have at least 2 options.`
        );
      }

      // Determine question type
      let type = question.type || "MCQ";

      // Format options efficiently
      const options = question.options.map((option) => {
        if (typeof option === "string") {
          return { optionText: option, isCorrect: false };
        } else if (typeof option === "object" && option.optionText) {
          return {
            optionText: option.optionText,
            isCorrect: option.isCorrect || false,
          };
        } else {
          throw new Error(
            `Invalid option format in question at index ${index}`
          );
        }
      });

      // Create question with minimal processing
      const formattedQuestion = {
        questionText: question.questionText,
        options: options,
        correctAnswer: question.correctAnswer,
        type: type,
        explanation: question.explanation || "",
        subject: question.subject || "",
        explanation: question.explanation || "",
      };

      // Add statement-related fields if present
      if (
        Array.isArray(question.statements) &&
        question.statements.length > 0
      ) {
        formattedQuestion.type = "STATEMENT_BASED";
        formattedQuestion.statements = question.statements.map((stmt, i) => {
          if (typeof stmt === "string") {
            return {
              statementNumber: i + 1,
              statementText: stmt,
              isCorrect: true, // Default value
            };
          } else if (typeof stmt === "object") {
            return {
              statementNumber: stmt.statementNumber || i + 1,
              statementText: stmt.statementText,
              isCorrect: stmt.isCorrect !== undefined ? stmt.isCorrect : true,
            };
          }
        });

        // Handle both possible property names
        formattedQuestion.statementInstruction =
          question.statementInstruction ||
          question.statementInstructions ||
          "Which of the following statements is/are correct?";
      }

      return formattedQuestion;
    });
  } catch (error) {
    console.error(`Error processing JSON at ${filePath}:`, error);
    throw new Error(`Failed to process JSON: ${error.message}`);
  }
};

// Handle file cleanup in case of errors
const cleanupFile = async (req) => {
  if (req.file && req.file.path) {
    await fs
      .unlink(req.file.path)
      .catch((err) => console.error("Error cleaning up file:", err));
  }
};

// Shared middleware to process the uploaded file - optimized for batches
const processUploadedFile = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError("No file uploaded", 400));
  }

  const filePath = req.file.path;
  const fileExt = path.extname(filePath).toLowerCase();

  // Ensure we're processing a JSON file
  if (fileExt !== ".json") {
    await cleanupFile(req);
    return next(
      new AppError("Unsupported file type. Only JSON files are allowed.", 400)
    );
  }

  try {
    // Process the JSON file and store the result in the request object
    req.extractedQuestions = await processJsonDocument(filePath);

    // Log batch size for monitoring
    console.log(
      `Processed batch of ${req.extractedQuestions.length} questions`
    );

    // Move to the next middleware
    next();
  } catch (error) {
    // Clean up file if there's an error
    await cleanupFile(req);
    return next(new AppError(error.message, 500));
  }
});

// Optimized controller for batch uploads
const uploadBulkQuestions = catchAsync(async (req, res, next) => {
  // Extract common fields
  const {
    questionsArray,
    examId,
    marks = 1,
    difficultyLevel = "MEDIUM",
    subject = "",
    hasNegativeMarking = false,
    negativeMarks = 0,
  } = req.body;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Efficiently check if exam exists using cached lookup
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

  // Use transaction for batch insert
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Prepare questions with common fields
    const questionsToInsert = questionsArray.map((q) => {
      // Store correctAnswer text directly
      const correctAnswerText = q.correctAnswer || "";

      // Process options and set the correct option
      const processedOptions = q.options.map((option) => {
        // For string format options, check if it matches the correctAnswer
        if (typeof option === "string") {
          return {
            optionText: option,
            isCorrect: option === correctAnswerText,
          };
        }
        // For object format options
        else if (typeof option === "object" && option.optionText) {
          return {
            optionText: option.optionText,
            isCorrect:
              option.optionText === correctAnswerText ||
              option.isCorrect ||
              false,
          };
        }
        return { optionText: option, isCorrect: false };
      });

      return {
        examId,
        questionText: q.questionText,
        marks: parseInt(marks, 10),
        type: q.type || "MCQ",
        options: processedOptions,
        correctAnswer: correctAnswerText,
        difficultyLevel,
        subject: q.subject || subject,
        hasNegativeMarking: hasNegativeMarking === "Yes" ? true : false,
        negativeMarks: parseFloat(negativeMarks),
        explanation: q.explanation || "",
        isActive: true,
        createdBy: userId,
        // Add statements if present
        ...(q.statements && q.statements.length > 0
          ? {
              statements: q.statements.map((statement, index) => ({
                statementNumber: index + 1,
                statementText: statement,
              })),
              statementInstruction:
                q.statementInstruction || q.statementInstructions,
              type: "STATEMENT_BASED", // Override type for statement-based questions
            }
          : {}),
      };
    });

    // Insert all questions in the batch at once
    const insertedQuestions = await Question.insertMany(questionsToInsert, {
      session,
    });

    await session.commitTransaction();
    session.endSession();

    // Cache each inserted question and invalidate exam questions cache
    const cachePromises = insertedQuestions.map((question) =>
      questionService.setQuestion(question._id.toString(), question.toJSON())
    );

    // Add invalidation of the questions by exam cache
    cachePromises.push(questionService.deleteQuestionsByExam(examId));

    // Execute all cache operations in parallel
    await Promise.all(cachePromises);

    // Send back minimal response to improve performance
    res.status(201).json({
      status: "success",
      message: `Successfully created ${insertedQuestions.length} questions`,
      data: {
        totalCreated: insertedQuestions,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    // Handle common errors specifically
    if (error.name === "ValidationError") {
      return next(new AppError(`Validation error: ${error.message}`, 400));
    } else if (error.name === "MongoServerError" && error.code === 11000) {
      return next(new AppError(`Duplicate entry found: ${error.message}`, 400));
    }

    return next(new AppError(error.message, 500));
  }
});

// Controller to validate questions without creating them
const validateBulkQuestions = catchAsync(async (req, res, next) => {
  // The extractedQuestions are now available from the previous middleware
  const extractedQuestions = req.extractedQuestions;

  // Clean up the uploaded file
  await cleanupFile(req);

  // Return simplified validation results
  res.status(200).json({
    status: "success",
    data: {
      totalQuestionsExtracted: extractedQuestions.length,
      statementBasedQuestions: extractedQuestions.filter(
        (q) => q.type === "STATEMENT_BASED"
      ).length,
      regularQuestions: extractedQuestions.filter(
        (q) => q.type !== "STATEMENT_BASED"
      ).length,
      preview: extractedQuestions.map((q) => ({
        type: q.type,
        questionText: q.questionText,
        isStatementBased: q.type === "STATEMENT_BASED",
        statements: q.statements || [],
        statementInstruction: q.statementInstruction || "",
        options: q.options,
        correctAnswer: q.correctAnswer,
        subject: q.subject || "",
        explanation: q.explanation || "",
      })),
    },
  });
});

// Middleware chain setup for routes
const bulkQuestionController = {
  uploadBulkQuestions: [uploadBulkQuestions],
  validateBulkQuestions: [
    upload.single("file"),
    processUploadedFile,
    validateBulkQuestions,
  ],
};

export default bulkQuestionController;
