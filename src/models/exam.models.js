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
      default: 30,
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
    maxAttempt: {
      type: Number,
      default: 1,
      min: [1, "Exam must allow at least 1 attempt"],
      max: [2, "Exam attempt cannot be more than 2 times"],
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

// Validation for maxAttempt and allowMultipleAttempts relationship
ExamSchema.pre("save", function (next) {
  // Validate maxAttempt based on allowMultipleAttempts
  if (!this.allowMultipleAttempts && this.maxAttempt > 1) {
    const error = new Error(
      "When multiple attempts are not allowed, maxAttempt should be 1"
    );
    return next(error);
  }

  if (this.allowMultipleAttempts && this.maxAttempt === 1) {
    const error = new Error(
      "When multiple attempts are allowed, maxAttempt should be greater than 1"
    );
    return next(error);
  }

  // Skip validation if totalMarks is not set
  if (!this.totalMarks) {
    return next();
  }

  // Calculate the minimum and maximum allowed percentage
  const minPassMark = (30 / 100) * this.totalMarks;
  const maxPassMark = (50 / 100) * this.totalMarks;

  // Get the current percentage value (ensure it's a number)
  const currentPassMark =
    Number(this.passMarkPercentage / 100) * this.totalMarks;

  // Check if percentage is within the allowed range
  if (currentPassMark < minPassMark || currentPassMark > maxPassMark) {
    const error = new Error(
      `Pass mark percentage must be between 30% and 50% of total marks.`
    );
    return next(error);
  }

  next();
});

// Also add the same validation to the pre-update middleware
ExamSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();

  // Validate maxAttempt and allowMultipleAttempts relationship for updates
  if (
    update.allowMultipleAttempts !== undefined ||
    update.maxAttempt !== undefined
  ) {
    // Get current document to check existing values
    this.model
      .findOne(this.getQuery())
      .then((doc) => {
        if (!doc) return next();

        const allowMultipleAttempts =
          update.allowMultipleAttempts !== undefined
            ? update.allowMultipleAttempts
            : doc.allowMultipleAttempts;

        const maxAttempt =
          update.maxAttempt !== undefined ? update.maxAttempt : doc.maxAttempt;

        if (!allowMultipleAttempts && maxAttempt > 1) {
          const error = new Error(
            "When multiple attempts are not allowed, maxAttempt should be 1"
          );
          return next(error);
        }

        if (allowMultipleAttempts && maxAttempt === 1) {
          const error = new Error(
            "When multiple attempts are allowed, maxAttempt should be greater than 1"
          );
          return next(error);
        }

        // Continue with passMarkPercentage validation...
        if (update.passMarkPercentage === undefined) {
          return next();
        }

        let totalMarksPromise;
        if (update.totalMarks !== undefined) {
          totalMarksPromise = Promise.resolve(Number(update.totalMarks));
        } else {
          totalMarksPromise = Promise.resolve(Number(doc.totalMarks));
        }

        totalMarksPromise
          .then((totalMarks) => {
            if (!totalMarks) return next();

            const minPassMark = (30 / 100) * totalMarks;
            const maxPassMark = (50 / 100) * totalMarks;
            const currentPassMark =
              Number(update.passMarkPercentage / 100) * totalMarks;

            if (
              currentPassMark < minPassMark ||
              currentPassMark > maxPassMark
            ) {
              const error = new Error(
                `Pass mark percentage must be between 30% and 50% of total marks.`
              );
              return next(error);
            }

            next();
          })
          .catch((err) => next(err));
      })
      .catch((err) => next(err));
  } else {
    // Continue with original passMarkPercentage validation...
    if (update.passMarkPercentage === undefined) {
      return next();
    }

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

        const minPassMark = (30 / 100) * totalMarks;
        const maxPassMark = (50 / 100) * totalMarks;
        const currentPassMark =
          Number(update.passMarkPercentage / 100) * totalMarks;

        if (currentPassMark < minPassMark || currentPassMark > maxPassMark) {
          const error = new Error(
            `Pass mark percentage must be between 30% and 50% of total marks.`
          );
          return next(error);
        }

        next();
      })
      .catch((err) => next(err));
  }
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
