import mongoose from "mongoose";

import {
  difficultyLevel,
  examCategory,
  tags,
  negativeMarkingValue,
} from "../utils/arrays.js";

const ExamSchema = new mongoose.Schema(
  {
    // basic fields
    isActive: {
      type: Boolean,
      default: true,
    },
    title: {
      type: String,
      required: [true, "Each exam must have a title"],
      min: [6, "Tittle must be at least 6 characters"],
      max: [100, "Exam title must have less than 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Each exam must have a description"],
      min: [10, "Description must be at least 10 characters."],
      max: [300, "Exam description must have less than 300 characters"],
    },
    duration: {
      type: Number,
      required: [true, "Each exam must have a duration"],
      min: [30, "Exam duration should not be less than 30 mins"],
    },
    totalQuestions: {
      type: Number,
      required: [true, "Each exam must have a total number of questions"],
      min: [10, "Each exam should include at least 10 questions"],
    },
    totalMarks: {
      type: Number,
      required: [true, "Each exam must have a total marks"],
      min: [10, "Each exam should be of at least 10 marks in total"],
    },
    hasNegativeMarking: {
      type: Boolean,
      default: false,
    },
    negativeMarkingValue: {
      type: Number,
      enum: negativeMarkingValue,
      default: 0,
    },
    passMarkPercentage: {
      type: Number,
      required: [true, "Each exam must have a pass mark percentage"],
      min: [30, "Pass mark percentage cannot be less than 30%"],
      max: [60, "Pass mark percentage cannot exceed 60"],
      default: 35,
    },
    difficultyLevel: {
      type: String,
      enum: difficultyLevel,
      default: "EASY",
    },
    category: {
      type: String,
      enum: examCategory,
      default: "TEST_SERIES",
    },
    allowNavigation: {
      type: Boolean,
      default: false,
    },
    startTime: {
      type: Date,
    },
    endTime: {
      type: Date,
    },
    allowMultipleAttempts: {
      type: Boolean,
      default: false,
    },

    // payment fields
    isPremium: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    accessPeriod: {
      type: Number,
    },

    // highlight
    isFeatured: {
      type: Boolean,
      default: false,
    },

    // Bundle support
    bundleTags: {
      type: [String],
      default: [],
      index: true,
    },

    tags: tags,
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "An exam must belong to a creator"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual populate for questions
ExamSchema.virtual("questions", {
  ref: "Question",
  foreignField: "examId",
  localField: "_id",
});

// Virtual populate for analytics
ExamSchema.virtual("analytics", {
  ref: "ExamAnalytics",
  foreignField: "examId",
  localField: "_id",
  justOne: true,
});

// Index for faster queries
ExamSchema.index({ category: 1 });
ExamSchema.index({ isActive: 1 });
ExamSchema.index({ tags: 1 });

const Exam = mongoose.model("Exam", ExamSchema);

export default Exam;
