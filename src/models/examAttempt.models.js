import mongoose from "mongoose";

const ExamAttemptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
    },
    timeRemaining: {
      type: Number, // Time remaining in seconds when exam was paused/submitted
    },
    status: {
      type: String,
      enum: ["in-progress", "completed", "paused", "timed-out"],
      default: "in-progress",
    },
    answers: [
      {
        questionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
          required: true,
        },
        selectedOption: mongoose.Schema.Types.Mixed, // Could be a string for MCQ or an array for multiple select
        isCorrect: {
          type: Boolean,
          default: null, // Will be calculated on submission
        },
        marksEarned: {
          type: Number,
          default: 0,
        },
        negativeMarks: {
          type: Number,
          default: 0,
        },
        responseTime: {
          type: Number, // Time taken to answer in seconds
          default: 0,
        },
      },
    ],
    totalMarks: {
      type: Number,
      default: 0,
    },
    negativeMarks: {
      type: Number,
      default: 0,
    },
    finalScore: {
      type: Number,
      default: 0,
    },
    correctAnswers: {
      type: Number,
      default: 0,
    },
    wrongAnswers: {
      type: Number,
      default: 0,
    },
    unattempted: {
      type: Number,
      default: 0,
    },
    hasPassed: {
      type: Boolean,
      default: false,
    },
    rank: {
      type: Number,
      default: null,
    },
    percentile: {
      type: Number,
      default: null,
    },
    lastDbSync: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual field for percentage score
ExamAttemptSchema.virtual("scorePercentage").get(function () {
  const examTotalMarks = this.populate("examId") ? this.examId.totalMarks : 0;

  if (examTotalMarks === 0) return 0;
  return ((this.finalScore / examTotalMarks) * 100).toFixed(2);
});

// Index for faster queries
ExamAttemptSchema.index({ userId: 1, examId: 1 });
ExamAttemptSchema.index({ status: 1 });
ExamAttemptSchema.index({ examId: 1, finalScore: -1 }); // For ranking

// Add a compound index on examId and createdAt to improve performance of recent attempts
ExamAttemptSchema.index({ examId: 1, createdAt: -1 });

const ExamAttempt = mongoose.model("ExamAttempt", ExamAttemptSchema);

export default ExamAttempt;
