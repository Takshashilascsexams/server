import mongoose from "mongoose";
import {
  questionTypes,
  difficultyLevel,
  negativeMarkingValue,
} from "../utils/arrays.js";

// schema for options
const optionSchema = new mongoose.Schema(
  {
    optionText: {
      type: String,
      required: [true, "Option text is required"],
    },
    isCorrect: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { _id: true }
);

// schema for statements
const statementSchema = new mongoose.Schema(
  {
    statementNumber: {
      type: Number,
      required: true,
    },
    statementText: {
      type: String,
      required: true,
      trim: true,
    },
    isCorrect: {
      type: Boolean,
      default: true, // Most statements are facts, mark false for incorrect statements
    },
  },
  { _id: true }
);

// schema for questions
const questionSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: [true, "Question must belong to an exam"],
      index: true, // Index for faster queries by exam
    },
    questionText: {
      type: String,
      required: [true, "Question text is required"],
      trim: true,
    },
    // New field for statements
    statements: {
      type: [statementSchema],
      default: [],
    },
    // New field for statement instruction
    statementInstruction: {
      type: String,
      trim: true,
    },
    marks: {
      type: Number,
      required: [true, "Marks are required"],
      min: [1, "Marks cannot be less than 1"],
    },

    // Question type and related fields
    type: {
      type: String,
      required: [true, "Question type is required"],
      enum: {
        values: questionTypes,
        message:
          "Question type must be one of: MCQ, MULTIPLE_SELECT, TRUE_FALSE, SHORT_ANSWER, LONG_ANSWER, STATEMENT_BASED",
      },
      index: true, // Index for filtering by question type
    },
    options: {
      type: [optionSchema],
      validate: {
        validator: function (options) {
          // For MCQ and MULTIPLE_SELECT, options are required
          if (["MCQ"].includes(this.type)) {
            return options && options.length > 0;
          }
          return true;
        },
        message:
          "Options are required for MCQ, MULTIPLE_SELECT and TRUE_FALSE questions",
      },
    },
    correctAnswer: {
      type: String,
      required: false,
    },
    // Difficulty and categorization
    difficultyLevel: {
      type: String,
      enum: difficultyLevel,
      default: "MEDIUM",
      index: true, // Index for filtering by difficulty
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
      index: true, // Index for filtering by topic
    },

    // Scoring settings
    hasNegativeMarking: {
      type: Boolean,
      default: false,
    },
    negativeMarks: {
      type: Number,
      enum: negativeMarkingValue,
      default: 0,
      validate: {
        validator: function (value) {
          return value >= 0; // Negative marks value should be positive or zero
        },
        message: "Negative marks value cannot be negative",
      },
    },

    // Media and additional content
    image: {
      type: String,
      trim: true,
    },
    explanation: {
      type: String,
      trim: true,
    },

    // Administrative fields
    isActive: {
      type: Boolean,
      default: true,
      index: true, // Index for active/inactive filtering
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Question must have a creator"],
    },

    // For bulk operations
    questionCode: {
      type: String,
      sparse: true,
      index: true, // For fast lookup by question code
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Update the checkAnswer method to use correctAnswer field (storing option text)
questionSchema.methods.checkAnswer = function (answer) {
  switch (this.type) {
    case "MCQ":
      // Find the option with matching text to the correctAnswer field
      const correctOption = this.options.find(
        (option) => option.optionText === this.correctAnswer
      );

      // Compare user's answer (option ID) with the correct option's ID
      return correctOption && correctOption._id.toString() === answer;

    case "MULTIPLE_SELECT":
      if (!Array.isArray(answer)) return false;
      const correctIds = this.options
        .filter((option) => option.isCorrect)
        .map((option) => option._id.toString());
      return (
        correctIds.length === answer.length &&
        correctIds.every((id) => answer.includes(id))
      );

    case "TRUE_FALSE":
      return (
        this.options
          .find(
            (option) =>
              option.optionText.toLowerCase() ===
              this.correctAnswer.toLowerCase()
          )
          ._id.toString() === answer
      );

    case "STATEMENT_BASED":
      // For statement-based questions, find option matching correctAnswer
      const correctStatementOption = this.options.find(
        (option) => option.optionText === this.correctAnswer
      );
      return (
        correctStatementOption &&
        correctStatementOption._id.toString() === answer
      );

    default:
      return false;
  }
};

// Keep existing static methods and middleware...

const Question = mongoose.model("Question", questionSchema);

export default Question;
