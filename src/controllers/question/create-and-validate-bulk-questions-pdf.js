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

// Helper function to detect if a question contains numbered statements
const hasNumberedStatements = (questionText) => {
  // Enhanced pattern to detect various statement formats
  const statementPattern =
    /(?:\n|\s)(?:[1-9][0-9]*\)|\([1-9][0-9]*\)|[1-9][0-9]*\.)/;

  // Check for "Consider the following statements" or "With reference to" text
  const considerPattern = /consider the following statements/i;
  const withReferencePattern =
    /with reference to.*?(?:consider the following statements|the following statements)/i;

  // If we have indicator phrases and statement patterns, it's likely a statement-based question
  if (
    (considerPattern.test(questionText) ||
      withReferencePattern.test(questionText)) &&
    statementPattern.test(questionText)
  ) {
    return true;
  }

  // Count the actual numbered statements
  const statementsRegex =
    /(?:\n|\s)(?:[1-9][0-9]*\)|\([1-9][0-9]*\)|[1-9][0-9]*\.)\s+/g;
  const matches = questionText.match(statementsRegex);

  // If we have at least 2 numbered statements, consider it a statement-based question
  return matches && matches.length >= 2;
};

// Extract statements from question text
const extractStatements = (questionText) => {
  // Extract introduction (text before first statement)
  const introPattern = /(.*?)(?:\n|\s)(?:1\)|\(1\)|1\.)/s;
  const introMatch = questionText.match(introPattern);

  let introduction = "";
  if (introMatch && introMatch[1]) {
    introduction = introMatch[1].trim();
  }

  // Extract statements using a more robust regex
  const statements = [];
  const statementsRegex =
    /(?:\n|\s)(?:([1-9][0-9]*)\)|\(([1-9][0-9]*)\)|([1-9][0-9]*)\.)\s*([\s\S]*?)(?=(?:\n|\s)(?:[1-9][0-9]*\)|\([1-9][0-9]*\)|[1-9][0-9]*\.)|(?:\n|\s)(?:Which|How|Select|a\)|a\.|a -|\(a\)|$))/g;

  let stmtMatch;
  while ((stmtMatch = statementsRegex.exec(questionText)) !== null) {
    // Get statement number from whichever capture group contains it
    const statementNum = parseInt(stmtMatch[1] || stmtMatch[2] || stmtMatch[3]);
    // Statement text is in the last capture group
    const statementText = stmtMatch[4].trim();

    if (statementText) {
      statements.push({
        statementNumber: statementNum,
        statementText: statementText,
        isCorrect: true, // Default value, will be adjusted based on answer
      });
    }
  }

  // Extract instruction text using multiple patterns
  let statementInstruction = "";
  const instructionPatterns = [
    /(?:Which of the statements given above is\s*\/?\s*are.*?)\?/i,
    /(?:Which of the statements is\s*\/?\s*are.*?)\?/i,
    /(?:Which of the statements given above is\s*\/?\s*are incorrect\?)/i,
    /(?:How many of the.*?statements.*?is\/are correct\?)/i,
    /(?:Select the correct answer using the codes given below:?)/i,
    /(?:Select the incorrect(?:ly matched)? pairs using the codes given below:?)/i,
    /(?:From the above statements which is\s*\/?\s*are.*?)\?/i,
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
    // Look for the section after all statements but before options
    const optionsStart = questionText.search(/(?:\n|\s)(?:a\)|a\.|a -|\(a\))/i);
    if (optionsStart !== -1) {
      // Find the last statement position
      const lastStatementPos = questionText.lastIndexOf(")");
      const lastStatementDotPos = questionText.lastIndexOf(".");
      const lastPos = Math.max(lastStatementPos, lastStatementDotPos);

      if (lastPos !== -1 && lastPos < optionsStart) {
        const instructionText = questionText
          .substring(lastPos + 1, optionsStart)
          .trim();
        if (instructionText.match(/(?:Which|How|Select|Choose)/i)) {
          statementInstruction = instructionText;
        }
      }
    }
  }

  // If introduction is empty but we found statements, create a default introduction
  if (!introduction && statements.length > 0) {
    if (questionText.match(/with reference to/i)) {
      introduction = "With reference to the following statements:";
    } else {
      introduction = "Consider the following statements:";
    }
  }

  return {
    introduction,
    statements,
    instruction: statementInstruction,
    fullOriginalText: questionText,
  };
};

// Process text-based documents (PDF/DOCX)
const processTextDocument = (text) => {
  // This regex pattern looks for:
  // - A question (starting with "Q:" or "Question:" or a number followed by ")")
  // - Four options (starting with A), B), C), D) or similar patterns)
  // - A correct answer (starting with "Correct:" or "Answer:")
  // - An optional explanation (starting with "Explanation:")

  const questionPattern =
    /(?:Q:|Question:|\d+\)|\d+\.)\s*(.*?)\s*(?=A\)|A\.|A\s*-|\(A\))/gis;
  const optionsPattern =
    /(?:([A-D]\)|[A-D]\.|[A-D]\s*-|\([A-D]\)))\s*(.*?)(?=(?:[A-D]\)|[A-D]\.|[A-D]\s*-|\([A-D]\))|Correct:|Answer:|Explanation:|$)/gis;
  const correctAnswerPattern =
    /(?:Correct:|Answer:)\s*([A-D])\s*(?=Explanation:|$)/gi;
  const explanationPattern =
    /Explanation:\s*([\s\S]*?)(?=$|(?:Q:|Question:|\d+\)|\d+\.))/gi;

  const questions = [];
  let questionMatch;
  let questionStartIndices = [];

  // First, find all question starting positions
  while ((questionMatch = questionPattern.exec(text)) !== null) {
    questionStartIndices.push(questionMatch.index);
  }

  // Add an end marker
  questionStartIndices.push(text.length);

  // Process each question block
  for (let i = 0; i < questionStartIndices.length - 1; i++) {
    const questionBlock = text.substring(
      questionStartIndices[i],
      questionStartIndices[i + 1]
    );

    // Reset regex lastIndex
    questionPattern.lastIndex = 0;
    optionsPattern.lastIndex = 0;
    correctAnswerPattern.lastIndex = 0;
    explanationPattern.lastIndex = 0;

    // Extract question text
    const questionTextMatch = questionPattern.exec(questionBlock);
    if (!questionTextMatch) continue;

    let questionText = questionTextMatch[1].trim();
    let type = "MCQ";
    let statements = [];
    let statementInstruction = "";

    // Check if this is a statement-based question
    if (hasNumberedStatements(questionText)) {
      const extractedData = extractStatements(questionText);

      if (extractedData.statements.length > 0) {
        statements = extractedData.statements;
        statementInstruction = extractedData.instruction;
        // Use only the introduction as the question text
        questionText = extractedData.introduction;
        type = "STATEMENT_BASED";
      }
    }

    // Extract options
    const options = [];
    let optionMatch;
    while ((optionMatch = optionsPattern.exec(questionBlock)) !== null) {
      const optionLetter = optionMatch[1].replace(/\)|\.|-|\(|\)/g, "").trim();
      const optionText = optionMatch[2].trim();
      options.push({
        optionText,
        isCorrect: false, // Will be updated when we find the correct answer
      });
    }

    // Extract correct answer
    let correctAnswer = "";
    let correctAnswerLetter = "";
    const correctAnswerMatch = correctAnswerPattern.exec(questionBlock);
    if (correctAnswerMatch) {
      correctAnswerLetter = correctAnswerMatch[1].trim();
      // Mark the correct option
      const correctIndex =
        correctAnswerLetter.charCodeAt(0) - "A".charCodeAt(0);
      if (options[correctIndex]) {
        options[correctIndex].isCorrect = true;
        correctAnswer = options[correctIndex].optionText;
      }
    }

    // Extract explanation
    let explanation = "";
    const explanationMatch = explanationPattern.exec(questionBlock);
    if (explanationMatch) {
      explanation = explanationMatch[1].trim();
    }

    // Only add if we have the required fields
    if ((questionText || type === "STATEMENT_BASED") && options.length >= 2) {
      const questionObj = {
        questionText:
          questionText || "With reference to the following statements:", // Default text if none found
        options,
        type,
        correctAnswer,
        explanation: explanation || "",
      };

      // Add statements if it's a statement-based question
      if (statements.length > 0) {
        questionObj.statements = statements;
        questionObj.statementInstruction = statementInstruction;
      }

      questions.push(questionObj);
    }
  }

  return questions;
};

// Controller methods
const bulkQuestionController = {
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
          type = "MCQ", // Default type, may be overridden for statement questions
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
          extractedQuestions = processTextDocument(text);
        } else if (fileExt === ".docx") {
          const text = await parseDocx(filePath);
          extractedQuestions = processTextDocument(text);
        } else {
          throw new Error("Unsupported file type");
        }

        if (extractedQuestions.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No valid questions found in the uploaded file",
          });
        }

        // Add common fields and creator info to all questions
        const userId = req.user._id;
        const questionsToInsert = extractedQuestions.map((q) => {
          // Start with the common fields
          const questionData = {
            examId,
            marks: parseInt(marks, 10),
            difficultyLevel,
            subject,
            hasNegativeMarking:
              hasNegativeMarking === "true" || hasNegativeMarking === true,
            negativeMarks: parseFloat(negativeMarks),
            createdBy: userId,
            isActive: true,
            questionText: q.questionText,
            options: q.options,
            explanation: q.explanation || "",
            correctAnswer: q.correctAnswer || "",
            // Use the detected type or fall back to the provided default
            type: q.type || type,
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
          extractedQuestions = processTextDocument(text);
        } else if (fileExt === ".docx") {
          const text = await parseDocx(filePath);
          extractedQuestions = processTextDocument(text);
        } else {
          throw new Error("Unsupported file type");
        }

        // Clean up the uploaded file
        await fs.unlink(filePath);

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
