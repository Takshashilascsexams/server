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
      min: [15, "Exam duration should not be less than 15 mins"],
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

// Then add a pre-save middleware to validate the percentage
ExamSchema.pre("save", function (next) {
  // Skip validation if totalMarks is not set
  if (!this.totalMarks) {
    return next();
  }

  // Calculate the minimum and maximum allowed percentage
  const minPercentage = (35 / 100) * this.totalMarks;
  const maxPercentage = (50 / 100) * this.totalMarks;

  // Get the current percentage value (ensure it's a number)
  const currentPercentage = Number(this.passMarkPercentage);

  // Check if percentage is within the allowed range
  if (currentPercentage < minPercentage || currentPercentage > maxPercentage) {
    const error = new Error(
      `Pass mark percentage must be between ${minPercentage}% and ${maxPercentage}% of total marks.`
    );
    return next(error);
  }

  next();
});

// Also add the same validation to the pre-update middleware
ExamSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();

  // If passMarkPercentage isn't being updated, skip validation
  if (update.passMarkPercentage === undefined) {
    return next();
  }

  // Get totalMarks (either from update or from the existing document)
  let totalMarksPromise;
  if (update.totalMarks !== undefined) {
    totalMarksPromise = Promise.resolve(Number(update.totalMarks));
  } else {
    totalMarksPromise = this.model.findOne(this.getQuery()).then((doc) => {
      return doc ? Number(doc.totalMarks) : null;
    });
  }

  totalMarksPromise
    .then((totalMarks) => {
      if (!totalMarks) return next();

      // Calculate the minimum and maximum allowed percentage
      const minPercentage = (35 / 100) * this.totalMarks;
      const maxPercentage = (50 / 100) * this.totalMarks;

      // Get the current percentage value (ensure it's a number)
      const currentPercentage = Number(update.passMarkPercentage);

      // Check if percentage is within the allowed range
      if (
        currentPercentage < minPercentage ||
        currentPercentage > maxPercentage
      ) {
        const error = new Error(
          `Pass mark percentage must be between ${minPercentage}% and ${maxPercentage}% of total marks.`
        );
        return next(error);
      }

      next();
    })
    .catch((err) => next(err));
});

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
