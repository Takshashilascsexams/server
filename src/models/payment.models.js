// src/models/payment.models.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    paymentDetails: {
      type: mongoose.Schema.Types.Mixed,
    },
    validUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
paymentSchema.index({ userId: 1, examId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ validUntil: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
