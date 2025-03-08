// models/testSeriesAnalyticsModel.js
import mongoose from "mongoose";

const ExamAnalyticsSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.ObjectId,
      ref: "Exam",
      required: [true, "Analytics must belong to an exam"],
      unique: true,
    },
    totalAttempted: {
      type: Number,
      default: 0,
    },
    totalCompleted: {
      type: Number,
      default: 0,
    },
    highestScore: {
      type: Number,
      default: 0,
    },
    lowestScore: {
      type: Number,
      default: 0,
    },
    averageScore: {
      type: Number,
      default: 0,
    },
    passCount: {
      type: Number,
      default: 0,
    },
    failCount: {
      type: Number,
      default: 0,
    },
    passPercentage: {
      type: Number,
      default: 0,
    },
    failPercentage: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
ExamAnalyticsSchema.index({ examId: 1 });

const ExamAnalytics = mongoose.model("ExamAnalytics", ExamAnalyticsSchema);

export default ExamAnalytics;
