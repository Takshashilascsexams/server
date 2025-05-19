import mongoose from "mongoose";

const PublicationSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    studentCount: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    storageProvider: {
      type: String,
      enum: ["local", "s3", "cloudinary", "firebase"],
      default: "cloudinary",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
PublicationSchema.index({ examId: 1, createdAt: -1 });
PublicationSchema.index({ isPublished: 1 });

const Publication = mongoose.model("Publication", PublicationSchema);

export default Publication;
