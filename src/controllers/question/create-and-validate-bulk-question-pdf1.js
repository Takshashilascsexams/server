import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { PDFExtract } from "pdf.js-extract";
import mammoth from "mammoth";
import Question from "../../models/questions.models.js";
import Exam from "../../models/exam.models.js";
import mongoose from "mongoose";

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(
      null,
      `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`
    );
  },
});

// Configure file filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error("Invalid file type. Only PDF and DOCX files are allowed."),
      false
    );
  }
};

// Initialize multer
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const pdfExtract = new PDFExtract();

const parsePdf = async (filePath) => {
  try {
    const data = await pdfExtract.extract(filePath);
    // Combine all page content into a single string
    const d = data.pages
      .map((page) => {
        return page.content.map((item) => item.str).join(" ");
      })
      .join("\n");

    return d;
  } catch (error) {
    console.error(`Error parsing PDF at ${filePath}:`, error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
};

// Parse DOCX
const parseDocx = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
};

/**
 * Extracts questions from PDF or DOCX exam documents
 * Returns objects compatible with the Question schema
 */
function extractQuestionsFromExamDocument(text) {
  // Ensure we have some text to work with
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    console.log("No valid text to process");
    return [];
  }

  // Clean the text and normalize line breaks
  const cleanedText = text.replace(/\r\n/g, "\n").replace(/\n\s*\n/g, "\n");

  // Find question blocks - each starts with a number followed by period
  const questions = [];
  const questionRegex = /(\d+)\.[\s\n]+([\s\S]*?)(?=(?:\n\s*\d+\.)|$)/g;

  let match;

  // Process each match
  while ((match = questionRegex.exec(cleanedText)) !== null) {
    const questionNumber = parseInt(match[1]);
    const questionContent = match[2].trim();

    console.log(questionNumber, questionContent);

    // Skip if content is too short to be a valid question
    if (questionContent.length < 10) continue;

    // Find where options start (more flexible pattern)
    const optionsStartPattern = /(?:\n|\s)([aA]\)|\([aA]\)|\s*[aA][\.\s]*\))/;
    const optionsStartMatch = questionContent.match(optionsStartPattern);

    if (!optionsStartMatch) continue; // Skip if no options found

    const optionsStartPos = questionContent.indexOf(optionsStartMatch[0]);
    if (optionsStartPos === -1) continue;

    // Split question text from options section
    const questionText = questionContent.substring(0, optionsStartPos).trim();
    const optionsSection = questionContent.substring(optionsStartPos);

    // Check if this is a statement-based question (has numbered statements)
    const statementPattern = /(?:\n|\s)(?:[1-9][0-9]*\)|\([1-9][0-9]*\))/;
    const isStatementBased = statementPattern.test(questionText);

    let introduction = questionText;
    let statements = [];
    let statementInstruction = "";

    if (isStatementBased) {
      // Extract introduction (text before first statement)
      const introPattern = /(.*?)(?:\n|\s)(?:1\)|\(1\))/s;
      const introMatch = questionText.match(introPattern);

      if (introMatch && introMatch[1]) {
        introduction = introMatch[1].trim();
      }

      // Extract statements
      const statementsRegex =
        /(?:\n|\s)(?:([1-9][0-9]*)\)|\(([1-9][0-9]*)\))\s*([\s\S]*?)(?=(?:\n|\s)(?:[1-9][0-9]*\)|\([1-9][0-9]*\))|(?:\n|\s)(?:Which|How|Select|$))/g;
      let stmtMatch;

      while ((stmtMatch = statementsRegex.exec(questionText)) !== null) {
        // Get statement number from either capture group 1 or 2
        const statementNum = parseInt(stmtMatch[1] || stmtMatch[2]);
        // Statement text is in capture group 3
        const statementText = stmtMatch[3].trim();

        if (statementText) {
          statements.push({
            statementNumber: statementNum,
            statementText: statementText,
            isCorrect: true, // Default value, as specified in your schema
          });
        }
      }

      // Extract instruction - use multiple patterns for different formats
      const instructionPatterns = [
        /(?:Which of the statements given above is\s*\/?\s*are.*?)\?/i,
        /(?:How many of the.*?statements.*?)\?/i,
        /(?:Select the.*?using the codes given below:?)/i,
        /(?:Select the.*?answer.*?using the codes given below:?)/i,
      ];

      for (const pattern of instructionPatterns) {
        const instructionMatch = questionText.match(pattern);
        if (instructionMatch) {
          statementInstruction = instructionMatch[0];
          break;
        }
      }

      // If no instruction found with specific patterns, try a more general approach
      if (!statementInstruction) {
        // Look for text after the last statement that could be an instruction
        const lastStatementPattern =
          /(?:[1-9][0-9]*\)|\([1-9][0-9]*\))(?:[\s\S]*?)$/;
        const lastStatementMatch = questionText.match(lastStatementPattern);

        if (lastStatementMatch) {
          // Find the position of the last statement number
          const lastNumMatch = questionText.match(
            /(?:[1-9][0-9]*\)|\([1-9][0-9]*\))(?![\s\S]*?(?:[1-9][0-9]*\)|\([1-9][0-9]*\)))/
          );

          if (lastNumMatch) {
            const pos =
              questionText.lastIndexOf(lastNumMatch[0]) +
              lastNumMatch[0].length;
            // Get everything after the last statement's number and content
            const remainingText = questionText.substring(pos).trim();

            // Find the start of the instruction
            const instructionStart = remainingText.search(
              /(?:Which|How|Select|Choose)/i
            );

            if (instructionStart !== -1) {
              statementInstruction = remainingText
                .substring(instructionStart)
                .trim();
            }
          }
        }
      }
    }

    // Extract options
    const options = [];
    // More robust pattern for options
    const optionsRegex =
      /(?:\n|\s)([a-d]\)|\([a-d]\))\s*([\s\S]*?)(?=(?:\n|\s)(?:[a-d]\)|\([a-d]\))|$)/gi;
    // const optionsRegex =
    //   /(?:^|\n|\s+)([a-d])[\.|\)]\s+((?:(?!\n\s*[a-d][\.|\)]\s+|\n\s*\d+\.\s+).)*)/gi;
    let optionMatch;
    let correctOptionIndex = -1;

    while ((optionMatch = optionsRegex.exec(optionsSection)) !== null) {
      // Get the option letter from capture group 1
      const optionLetter = optionMatch[1].trim().toLowerCase()[0];
      // The option text is in capture group 2
      const optionText = optionMatch[2].trim();

      if (optionText) {
        // Store the index of the first option (usually the correct one for MCQs)
        if (correctOptionIndex === -1) {
          correctOptionIndex = options.length;
        }

        options.push({
          optionText: optionText,
          isCorrect: false, // Will be set correctly later
        });
      }
    }

    // Set the first option as correct by default (can be updated later)
    if (options.length > 0) {
      options[0].isCorrect = true;
    }

    // Only add questions with both text and options
    if (questionText && options.length > 0) {
      const questionObj = {
        questionText: introduction,
        type: isStatementBased ? "STATEMENT_BASED" : "MCQ",
        options: options,
        correctAnswer: options.length > 0 ? options[0]._id : undefined, // Will be set properly after options are created
        marks: 1, // Default value
        difficultyLevel: "MEDIUM", // Default value
        subject: "", // Will be set from request body
        hasNegativeMarking: false, // Default value
        negativeMarks: 0, // Default value
        explanation: "", // Default value
        isActive: true, // Default value
        questionCode: `Q${questionNumber}`, // Generate a question code
      };

      // Add statements and instruction if it's a statement-based question
      if (isStatementBased && statements.length > 0) {
        questionObj.statements = statements;
        questionObj.statementInstruction = statementInstruction;
      }

      // console.log("qObj:", questionObj);

      questions.push(questionObj);
    }
  }

  // console.log(questions);

  return questions;
}

/**
 * Formats extracted questions to fully comply with the Question schema
 * Adds required fields and ensures proper structure
 */
function formatQuestionsForSchema(extractedQuestions, commonFields) {
  const {
    examId,
    marks,
    difficultyLevel,
    subject,
    hasNegativeMarking,
    negativeMarks,
    userId,
  } = commonFields;

  return extractedQuestions.map((question, index) => {
    // Generate a question object that fully complies with the schema
    const formattedQuestion = {
      examId,
      questionText: question.questionText,
      type: question.type,
      marks: parseInt(marks, 10) || 1,
      difficultyLevel: difficultyLevel || "MEDIUM",
      subject: subject || "",
      hasNegativeMarking:
        hasNegativeMarking === "true" || hasNegativeMarking === true,
      negativeMarks: parseFloat(negativeMarks) || 0,
      options: question.options.map((option) => ({
        optionText: option.optionText,
        isCorrect: option.isCorrect,
      })),
      isActive: true,
      createdBy: userId,
      questionCode: question.questionCode || `Q${index + 1}`,
    };

    // Add statements for statement-based questions
    if (
      question.type === "STATEMENT_BASED" &&
      question.statements &&
      question.statements.length > 0
    ) {
      formattedQuestion.statements = question.statements;
      formattedQuestion.statementInstruction =
        question.statementInstruction || "";
    }

    // Set correct answer for MCQ (not needed for STATEMENT_BASED or MULTIPLE_SELECT)
    if (question.type === "MCQ") {
      const correctOption = question.options.find((opt) => opt.isCorrect);
      if (correctOption) {
        formattedQuestion.correctAnswer = "A"; // Default to first option, will be replaced with actual ID after insertion
      }
    }

    return formattedQuestion;
  });
}

// Controller methods
const bulkQuestionController = {
  // Generate an array of questions from a file without saving to database
  generateQuestions: [
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res
            .status(400)
            .json({ success: false, message: "No file uploaded" });
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
          return res
            .status(400)
            .json({ success: false, message: "Exam ID is required" });
        }

        const filePath = req.file.path;
        const fileExt = path.extname(filePath).toLowerCase();

        let extractedQuestions;

        // Parse file based on type
        if (fileExt === ".pdf") {
          const text = await parsePdf(filePath);
          extractedQuestions = extractQuestionsFromExamDocument(text);
        } else if (fileExt === ".docx") {
          const text = await parseDocx(filePath);
          extractedQuestions = extractQuestionsFromExamDocument(text);
        } else {
          throw new Error("Unsupported file type");
        }

        if (extractedQuestions.length === 0) {
          // Clean up the uploaded file
          await fs.unlink(filePath);

          return res.status(400).json({
            success: false,
            message: "No valid questions found in the uploaded file",
          });
        }

        // Format questions to fully comply with the schema
        const userId = req.user?._id || mongoose.Types.ObjectId();
        const formattedQuestions = formatQuestionsForSchema(
          extractedQuestions,
          {
            examId,
            marks,
            difficultyLevel,
            subject,
            hasNegativeMarking,
            negativeMarks,
            userId,
          }
        );

        // Clean up the uploaded file
        await fs.unlink(filePath);

        return res.status(200).json({
          success: true,
          message: `Successfully generated ${formattedQuestions.length} questions`,
          data: {
            totalQuestions: formattedQuestions.length,
            statementBasedQuestions: formattedQuestions.filter(
              (q) => q.type === "STATEMENT_BASED"
            ).length,
            regularQuestions: formattedQuestions.filter((q) => q.type === "MCQ")
              .length,
            questions: formattedQuestions,
          },
        });
      } catch (error) {
        // Clean up file if it exists
        if (req.file && req.file.path) {
          await fs.unlink(req.file.path).catch(() => {});
        }

        return res.status(500).json({
          success: false,
          message: "Failed to generate questions",
          error: error.message,
        });
      }
    },
  ],

  // Upload and process bulk questions
  uploadBulkQuestions: [
    upload.single("file"),
    async (req, res) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        if (!req.file) {
          return res
            .status(400)
            .json({ success: false, message: "No file uploaded" });
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
          return res
            .status(400)
            .json({ success: false, message: "Exam ID is required" });
        }

        // Check if exam exists
        const exam = await Exam.findById(examId);
        if (!exam) {
          return res
            .status(404)
            .json({ success: false, message: "Exam not found" });
        }

        const filePath = req.file.path;
        const fileExt = path.extname(filePath).toLowerCase();

        let extractedQuestions;

        // Parse file based on type
        if (fileExt === ".pdf") {
          const text = await parsePdf(filePath);
          extractedQuestions = extractQuestionsFromExamDocument(text);
        } else if (fileExt === ".docx") {
          const text = await parseDocx(filePath);
          extractedQuestions = extractQuestionsFromExamDocument(text);
        } else {
          throw new Error("Unsupported file type");
        }

        if (extractedQuestions.length === 0) {
          await session.abortTransaction();
          session.endSession();

          // Clean up the uploaded file
          await fs.unlink(filePath);

          return res.status(400).json({
            success: false,
            message: "No valid questions found in the uploaded file",
          });
        }

        // Format questions for the schema
        const userId = req.user._id;
        const formattedQuestions = formatQuestionsForSchema(
          extractedQuestions,
          {
            examId,
            marks,
            difficultyLevel,
            subject,
            hasNegativeMarking,
            negativeMarks,
            userId,
          }
        );

        // Insert questions
        const insertedQuestions = await Question.insertMany(
          formattedQuestions,
          {
            session,
          }
        );

        // Update correctAnswer fields with actual option IDs
        const updates = insertedQuestions.map(async (question, index) => {
          if (question.type === "MCQ") {
            const correctOption = question.options.find((opt) => opt.isCorrect);
            if (correctOption) {
              await Question.findByIdAndUpdate(
                question._id,
                { correctAnswer: correctOption._id.toString() },
                { session }
              );
            }
          }
        });

        await Promise.all(updates);

        // Clean up the uploaded file
        await fs.unlink(filePath);

        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
          success: true,
          message: `Successfully created ${insertedQuestions.length} questions`,
          data: {
            totalCreated: insertedQuestions.length,
            questions: insertedQuestions.map((q) => ({
              _id: q._id,
              type: q.type,
              questionText:
                q.questionText.substring(0, 50) +
                (q.questionText.length > 50 ? "..." : ""),
              hasStatements: q.statements && q.statements.length > 0,
              statementCount: q.statements ? q.statements.length : 0,
            })),
          },
        });
      } catch (error) {
        await session.abortTransaction();
        session.endSession();

        // Clean up file if it exists
        if (req.file && req.file.path) {
          await fs.unlink(req.file.path).catch(() => {});
        }

        return res.status(500).json({
          success: false,
          message: "Failed to process bulk questions",
          error: error.message,
        });
      }
    },
  ],

  // Validate questions without creating them
  validateBulkQuestions: [
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res
            .status(400)
            .json({ success: false, message: "No file uploaded" });
        }

        const filePath = req.file.path;
        const fileExt = path.extname(filePath).toLowerCase();

        let extractedQuestions;

        // Parse file based on type
        if (fileExt === ".pdf") {
          const text = await parsePdf(filePath);
          extractedQuestions = extractQuestionsFromExamDocument(text);
        } else if (fileExt === ".docx") {
          const text = await parseDocx(filePath);
          extractedQuestions = extractQuestionsFromExamDocument(text);
        } else {
          throw new Error("Unsupported file type");
        }

        // Clean up the uploaded file
        await fs.unlink(filePath);

        // console.log(extractedQuestions);

        return res.status(200).json({
          success: true,
          data: {
            totalQuestionsExtracted: extractedQuestions.length,
            statementBasedQuestions: extractedQuestions.filter(
              (q) => q.type === "STATEMENT_BASED"
            ).length,
            regularQuestions: extractedQuestions.filter(
              (q) => q.type !== "STATEMENT_BASED"
            ).length,
            preview: extractedQuestions.slice(0, 5).map((q) => ({
              type: q.type,
              questionText: q.questionText,
              isStatementBased: q.type === "STATEMENT_BASED",
              statements: q.statements || [],
              statementInstruction: q.statementInstruction || "",
              options: q.options || [],
            })),
          },
        });
      } catch (error) {
        // Clean up file if it exists
        if (req.file && req.file.path) {
          await fs.unlink(req.file.path).catch(() => {});
        }

        return res.status(500).json({
          success: false,
          message: "Failed to validate bulk questions",
          error: error.message,
        });
      }
    },
  ],
};

export default bulkQuestionController;
