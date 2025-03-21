// import multer from "multer";
// import path from "path";
// import fs from "fs/promises";
// import Question from "../../models/questions.models.js";
// import Exam from "../../models/exam.models.js";
// import User from "../../models/user.models.js";
// import mongoose from "mongoose";

// // Configure storage
// const storage = multer.diskStorage({
//   limits: {
//     fileSize: 5 * 1024 * 1024, // 5MB limit for files
//   },
//   destination: (req, file, cb) => {
//     cb(null, "uploads/");
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
//     cb(
//       null,
//       `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`
//     );
//   },
// });

// // Configure file filter - only allow JSON files
// const fileFilter = (req, file, cb) => {
//   const allowedTypes = ["application/json"];

//   if (allowedTypes.includes(file.mimetype)) {
//     cb(null, true);
//   } else {
//     cb(new Error("Invalid file type. Only JSON files are allowed."), false);
//   }
// };

// // Initialize multer
// const upload = multer({
//   storage,
//   fileFilter,
//   limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
// });

// // Process JSON document
// // const processJsonDocument = async (filePath) => {
// //   try {
// //     // Read the JSON file
// //     const jsonData = await fs.readFile(filePath, "utf8");

// //     // Parse the JSON content
// //     const questions = JSON.parse(jsonData);

// //     // Validate the JSON structure
// //     if (!Array.isArray(questions)) {
// //       throw new Error("Invalid JSON format. Expected an array of questions.");
// //     }

// //     // Validate and format each question
// //     const formattedQuestions = questions.map((question, index) => {
// //       // Basic validation
// //       if (!question.questionText) {
// //         throw new Error(`Question at index ${index} is missing questionText.`);
// //       }

// //       if (!Array.isArray(question.options) || question.options.length < 4) {
// //         throw new Error(
// //           `Question at index ${index} has invalid options. Must have at least 4 options.`
// //         );
// //       }

// //       // Determine question type
// //       let type = question.type || "MCQ";

// //       // Format options to ensure they have the required structure
// //       const options = question.options.map((option) => {
// //         if (typeof option === "string") {
// //           // If option is just a string, convert to required format
// //           return {
// //             optionText: option,
// //             isCorrect: false, // Will be updated later
// //           };
// //         } else if (typeof option === "object" && option.optionText) {
// //           // If option is already in the correct format
// //           return {
// //             optionText: option.optionText,
// //             isCorrect: option.isCorrect || false,
// //           };
// //         } else {
// //           throw new Error(
// //             `Invalid option format in question at index ${index}`
// //           );
// //         }
// //       });

// //       // Find the correct option
// //       if (question.correctAnswer !== undefined) {
// //         // If correctAnswer is an index or letter
// //         if (typeof question.correctAnswer === "number") {
// //           // If it's an index
// //           if (
// //             question.correctAnswer >= 0 &&
// //             question.correctAnswer < options.length
// //           ) {
// //             options[question.correctAnswer].isCorrect = true;
// //           }
// //         } else if (typeof question.correctAnswer === "string") {
// //           // If it's a letter (A, B, C, D)
// //           const correctIndex =
// //             question.correctAnswer.charCodeAt(0) - "A".charCodeAt(0);
// //           if (correctIndex >= 0 && correctIndex < options.length) {
// //             options[correctIndex].isCorrect = true;
// //           }
// //         }
// //       } else if (question.correctOptionIndex !== undefined) {
// //         // If using correctOptionIndex
// //         if (
// //           question.correctOptionIndex >= 0 &&
// //           question.correctOptionIndex < options.length
// //         ) {
// //           options[question.correctOptionIndex].isCorrect = true;
// //         }
// //       } else {
// //         // Check if any option is already marked as correct
// //         const hasCorrectOption = options.some((option) => option.isCorrect);
// //         if (!hasCorrectOption) {
// //           throw new Error(
// //             `Question at index ${index} has no correct answer specified.`
// //           );
// //         }
// //       }

// //       // Create the formatted question object
// //       const formattedQuestion = {
// //         questionText: question.questionText,
// //         options: options,
// //         type: type,
// //         explanation: question.explanation || "",
// //         correctAnswer: options.find((opt) => opt.isCorrect)?.optionText || "",
// //       };

// //       // Add statement-related fields if present
// //       if (
// //         Array.isArray(question.statements) &&
// //         question.statements.length > 0
// //       ) {
// //         formattedQuestion.type = "STATEMENT_BASED";
// //         formattedQuestion.statements = question.statements.map((stmt, i) => {
// //           if (typeof stmt === "string") {
// //             return {
// //               statementNumber: i + 1,
// //               statementText: stmt,
// //               isCorrect: true, // Default value
// //             };
// //           } else if (typeof stmt === "object") {
// //             return {
// //               statementNumber: stmt.statementNumber || i + 1,
// //               statementText: stmt.statementText,
// //               isCorrect: stmt.isCorrect !== undefined ? stmt.isCorrect : true,
// //             };
// //           }
// //         });
// //         formattedQuestion.statementInstruction =
// //           question.statementInstruction ||
// //           "Which of the following statements is/are correct?";
// //       }

// //       return formattedQuestion;
// //     });

// //     return formattedQuestions;
// //   } catch (error) {
// //     console.error(`Error processing JSON at ${filePath}:`, error);
// //     throw new Error(`Failed to process JSON: ${error.message}`);
// //   }
// // };

// const processJsonDocument = async (filePath) => {
//   try {
//     // Read the JSON file
//     const jsonData = await fs.readFile(filePath, "utf8");

//     // Parse the JSON content
//     const questions = JSON.parse(jsonData);

//     // Validate the JSON structure
//     if (!Array.isArray(questions)) {
//       throw new Error("Invalid JSON format. Expected an array of questions.");
//     }

//     // Validate and format each question
//     const formattedQuestions = questions.map((question, index) => {
//       // Basic validation
//       if (!question.questionText) {
//         throw new Error(`Question at index ${index} is missing questionText.`);
//       }

//       if (!Array.isArray(question.options) || question.options.length < 2) {
//         throw new Error(
//           `Question at index ${index} has invalid options. Must have at least 2 options.`
//         );
//       }

//       // Determine question type
//       let type = question.type || "MCQ";

//       // Format options to ensure they have the required structure
//       const options = question.options.map((option) => {
//         if (typeof option === "string") {
//           // If option is just a string, convert to required format
//           return {
//             optionText: option,
//             isCorrect: false, // Will be updated later if a correct answer is specified
//           };
//         } else if (typeof option === "object" && option.optionText) {
//           // If option is already in the correct format
//           return {
//             optionText: option.optionText,
//             isCorrect: option.isCorrect || false,
//           };
//         } else {
//           throw new Error(
//             `Invalid option format in question at index ${index}`
//           );
//         }
//       });

//       // Set correct option if specified (now optional)
//       let hasSpecifiedCorrectAnswer = false;

//       if (question.correctAnswer !== undefined) {
//         // If correctAnswer is an index or letter
//         if (typeof question.correctAnswer === "number") {
//           // If it's an index
//           if (
//             question.correctAnswer >= 0 &&
//             question.correctAnswer < options.length
//           ) {
//             options[question.correctAnswer].isCorrect = true;
//             hasSpecifiedCorrectAnswer = true;
//           }
//         } else if (typeof question.correctAnswer === "string") {
//           // If it's a letter (A, B, C, D)
//           const correctIndex =
//             question.correctAnswer.charCodeAt(0) - "A".charCodeAt(0);
//           if (correctIndex >= 0 && correctIndex < options.length) {
//             options[correctIndex].isCorrect = true;
//             hasSpecifiedCorrectAnswer = true;
//           }
//         }
//       } else if (question.correctOptionIndex !== undefined) {
//         // If using correctOptionIndex
//         if (
//           question.correctOptionIndex >= 0 &&
//           question.correctOptionIndex < options.length
//         ) {
//           options[question.correctOptionIndex].isCorrect = true;
//           hasSpecifiedCorrectAnswer = true;
//         }
//       } else {
//         // Check if any option is already marked as correct
//         hasSpecifiedCorrectAnswer = options.some((option) => option.isCorrect);
//       }

//       // Create the formatted question object
//       const formattedQuestion = {
//         questionText: question.questionText,
//         options: options,
//         type: type,
//         explanation: question.explanation || "", // Optional field
//       };

//       // Only add correctAnswer field if one was specified
//       if (hasSpecifiedCorrectAnswer) {
//         formattedQuestion.correctAnswer =
//           options.find((opt) => opt.isCorrect)?.optionText || "";
//       }

//       // Add statement-related fields if present
//       if (
//         Array.isArray(question.statements) &&
//         question.statements.length > 0
//       ) {
//         formattedQuestion.type = "STATEMENT_BASED";
//         formattedQuestion.statements = question.statements.map((stmt, i) => {
//           if (typeof stmt === "string") {
//             return {
//               statementNumber: i + 1,
//               statementText: stmt,
//               isCorrect: true, // Default value
//             };
//           } else if (typeof stmt === "object") {
//             return {
//               statementNumber: stmt.statementNumber || i + 1,
//               statementText: stmt.statementText,
//               isCorrect: stmt.isCorrect !== undefined ? stmt.isCorrect : true,
//             };
//           }
//         });
//         formattedQuestion.statementInstruction =
//           question.statementInstruction ||
//           "Which of the following statements is/are correct?";
//       }

//       return formattedQuestion;
//     });

//     return formattedQuestions;
//   } catch (error) {
//     console.error(`Error processing JSON at ${filePath}:`, error);
//     throw new Error(`Failed to process JSON: ${error.message}`);
//   }
// };

// // Controller methods
// const bulkQuestionController = {
//   // Upload and process bulk questions
//   uploadBulkQuestions: [
//     upload.single("file"),
//     async (req, res) => {
//       const session = await mongoose.startSession();
//       session.startTransaction();

//       try {
//         if (!req.file) {
//           return res
//             .status(400)
//             .json({ success: false, message: "No file uploaded" });
//         }

//         // Extract common fields that will be applied to all questions
//         const {
//           examId,
//           marks = 1,
//           difficultyLevel = "MEDIUM",
//           subject = "",
//           hasNegativeMarking = false,
//           negativeMarks = 0,
//         } = req.body;

//         if (!examId) {
//           return res
//             .status(400)
//             .json({ success: false, message: "Exam ID is required" });
//         }

//         // Check if exam exists
//         const exam = await Exam.findById(examId);
//         if (!exam) {
//           return res
//             .status(404)
//             .json({ success: false, message: "Exam not found" });
//         }

//         const filePath = req.file.path;
//         const fileExt = path.extname(filePath).toLowerCase();

//         // Ensure we're processing a JSON file
//         if (fileExt !== ".json") {
//           throw new Error(
//             "Unsupported file type. Only JSON files are allowed."
//           );
//         }

//         // Process the JSON file
//         const extractedQuestions = await processJsonDocument(filePath);

//         if (extractedQuestions.length === 0) {
//           return res.status(400).json({
//             success: false,
//             message: "No valid questions found in the uploaded file",
//           });
//         }

//         // Add common fields and creator info to all questions
//         const clerkId = req.user.sub;
//         const user = await User.findOne({ clerkId });

//         const questionsToInsert = extractedQuestions.map((q) => {
//           // Start with the common fields
//           const questionData = {
//             examId,
//             questionText: q.questionText,
//             marks: parseInt(marks, 10),
//             type: q.type,
//             options: q.options,
//             correctAnswer: q.correctAnswer || "",
//             difficultyLevel,
//             subject,
//             hasNegativeMarking:
//               hasNegativeMarking === "true" || hasNegativeMarking === true,
//             negativeMarks: parseFloat(negativeMarks),
//             explanation: q.explanation || "",
//             isActive: true,
//             createdBy: user._id,
//           };

//           // Add statements if present
//           if (q.statements && q.statements.length > 0) {
//             questionData.statements = q.statements;
//             questionData.statementInstruction = q.statementInstruction;
//           }

//           return questionData;
//         });

//         // Insert questions
//         const insertedQuestions = await Question.insertMany(questionsToInsert, {
//           session,
//         });

//         // Clean up the uploaded file
//         await fs.unlink(filePath);

//         await session.commitTransaction();
//         session.endSession();

//         return res.status(201).json({
//           success: true,
//           message: `Successfully created ${insertedQuestions.length} questions`,
//           data: {
//             totalCreated: insertedQuestions.length,
//             questions: insertedQuestions,
//           },
//         });
//       } catch (error) {
//         await session.abortTransaction();
//         session.endSession();

//         // Clean up file if it exists
//         if (req.file && req.file.path) {
//           await fs.unlink(req.file.path).catch(() => {});
//         }

//         return res.status(500).json({
//           success: false,
//           message: "Failed to process bulk questions",
//           error: error.message,
//         });
//       }
//     },
//   ],

//   // Validate questions without creating them
//   validateBulkQuestions: [
//     upload.single("file"),
//     async (req, res) => {
//       try {
//         if (!req.file) {
//           return res
//             .status(400)
//             .json({ success: false, message: "No file uploaded" });
//         }

//         const filePath = req.file.path;
//         const fileExt = path.extname(filePath).toLowerCase();

//         // Ensure we're processing a JSON file
//         if (fileExt !== ".json") {
//           throw new Error(
//             "Unsupported file type. Only JSON files are allowed."
//           );
//         }

//         // Process the JSON file
//         const extractedQuestions = await processJsonDocument(filePath);

//         // Clean up the uploaded file
//         await fs.unlink(filePath);

//         return res.status(200).json({
//           success: true,
//           data: {
//             totalQuestionsExtracted: extractedQuestions.length,
//             statementBasedQuestions: extractedQuestions.filter(
//               (q) => q.type === "STATEMENT_BASED"
//             ).length,
//             regularQuestions: extractedQuestions.filter(
//               (q) => q.type !== "STATEMENT_BASED"
//             ).length,
//             preview: extractedQuestions.map((q) => ({
//               type: q.type,
//               questionText: q.questionText,
//               isStatementBased: q.type === "STATEMENT_BASED",
//               statements: q.statements || [],
//               statementInstruction: q.statementInstruction || "",
//               options: q.options,
//             })),
//           },
//         });
//       } catch (error) {
//         // Clean up file if it exists
//         if (req.file && req.file.path) {
//           await fs.unlink(req.file.path).catch(() => {});
//         }

//         return res.status(500).json({
//           success: false,
//           message: "Failed to validate bulk questions",
//           error: error.message,
//         });
//       }
//     },
//   ],
// };

// export default bulkQuestionController;

import multer from "multer";
import path from "path";
import fs from "fs/promises";
import Question from "../../models/questions.models.js";
import Exam from "../../models/exam.models.js";
import User from "../../models/user.models.js";
import mongoose from "mongoose";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import storage from "../../utils/multerConfig.js";

// Configure file filter - only allow JSON files
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["application/json"];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only JSON files are allowed."), false);
  }
};

// Initialize multer
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Process JSON document
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

    // Validate and format each question
    const formattedQuestions = questions.map((question, index) => {
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

      // Format options to ensure they have the required structure
      const options = question.options.map((option) => {
        if (typeof option === "string") {
          // If option is just a string, convert to required format
          return {
            optionText: option,
            isCorrect: false, // Will be updated later if a correct answer is specified
          };
        } else if (typeof option === "object" && option.optionText) {
          // If option is already in the correct format
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

      // Set correct option if specified (now optional)
      let hasSpecifiedCorrectAnswer = false;

      if (question.correctAnswer !== undefined) {
        // If correctAnswer is an index or letter
        if (typeof question.correctAnswer === "number") {
          // If it's an index
          if (
            question.correctAnswer >= 0 &&
            question.correctAnswer < options.length
          ) {
            options[question.correctAnswer].isCorrect = true;
            hasSpecifiedCorrectAnswer = true;
          }
        } else if (typeof question.correctAnswer === "string") {
          // If it's a letter (A, B, C, D)
          const correctIndex =
            question.correctAnswer.charCodeAt(0) - "A".charCodeAt(0);
          if (correctIndex >= 0 && correctIndex < options.length) {
            options[correctIndex].isCorrect = true;
            hasSpecifiedCorrectAnswer = true;
          }
        }
      } else if (question.correctOptionIndex !== undefined) {
        // If using correctOptionIndex
        if (
          question.correctOptionIndex >= 0 &&
          question.correctOptionIndex < options.length
        ) {
          options[question.correctOptionIndex].isCorrect = true;
          hasSpecifiedCorrectAnswer = true;
        }
      } else {
        // Check if any option is already marked as correct
        hasSpecifiedCorrectAnswer = options.some((option) => option.isCorrect);
      }

      // Create the formatted question object
      const formattedQuestion = {
        questionText: question.questionText,
        options: options,
        type: type,
        explanation: question.explanation || "", // Optional field
      };

      // Only add correctAnswer field if one was specified
      if (hasSpecifiedCorrectAnswer) {
        formattedQuestion.correctAnswer =
          options.find((opt) => opt.isCorrect)?.optionText || "";
      }

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
        formattedQuestion.statementInstruction =
          question.statementInstruction ||
          "Which of the following statements is/are correct?";
      }

      return formattedQuestion;
    });

    return formattedQuestions;
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

// Controller methods
const uploadBulkQuestions = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.file) {
      return next(new AppError("No file uploaded", 400));
    }

    // Extract common fields that will be applied to all questions
    const {
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

    // Check if exam exists
    const exam = await Exam.findById(examId);
    if (!exam) {
      return next(new AppError("Exam not found", 404));
    }

    const filePath = req.file.path;
    const fileExt = path.extname(filePath).toLowerCase();

    // Ensure we're processing a JSON file
    if (fileExt !== ".json") {
      return next(
        new AppError("Unsupported file type. Only JSON files are allowed.", 400)
      );
    }

    // Process the JSON file
    const extractedQuestions = await processJsonDocument(filePath);

    if (extractedQuestions.length === 0) {
      return next(
        new AppError("No valid questions found in the uploaded file", 400)
      );
    }

    // Add common fields and creator info to all questions
    const clerkId = req.user.sub;
    const user = await User.findOne({ clerkId });

    const questionsToInsert = extractedQuestions.map((q) => {
      // Start with the common fields
      const questionData = {
        examId,
        questionText: q.questionText,
        marks: parseInt(marks, 10),
        type: q.type,
        options: q.options,
        correctAnswer: q.correctAnswer || "",
        difficultyLevel,
        subject,
        hasNegativeMarking:
          hasNegativeMarking === "true" || hasNegativeMarking === true,
        negativeMarks: parseFloat(negativeMarks),
        explanation: q.explanation || "",
        isActive: true,
        createdBy: user._id,
      };

      // Add statements if present
      if (q.statements && q.statements.length > 0) {
        questionData.statements = q.statements;
        questionData.statementInstruction = q.statementInstruction;
      }

      return questionData;
    });

    // Insert questions
    const insertedQuestions = await Question.insertMany(questionsToInsert, {
      session,
    });

    // Clean up the uploaded file
    await fs.unlink(filePath);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: "success",
      message: `Successfully created ${insertedQuestions.length} questions`,
      data: {
        totalCreated: insertedQuestions.length,
        questions: insertedQuestions,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    // Clean up file if it exists
    await cleanupFile(req);

    // Forward the error to the global error handler
    return next(new AppError(error.message, 500));
  }
});

const validateBulkQuestions = catchAsync(async (req, res, next) => {
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

  // Process the JSON file
  const extractedQuestions = await processJsonDocument(filePath);

  // Clean up the uploaded file
  await fs.unlink(filePath);

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
      })),
    },
  });
});

// Middleware chain setup for routes
const bulkQuestionController = {
  uploadBulkQuestions: [upload.single("file"), uploadBulkQuestions],
  validateBulkQuestions: [upload.single("file"), validateBulkQuestions],
};

export default bulkQuestionController;
