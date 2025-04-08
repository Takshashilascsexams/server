// src/controllers/payment/verify-payment.js
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import Payment from "../../models/payment.models.js";
import Razorpay from "razorpay"; // Example payment gateway
import crypto from "crypto";

const verifyPayment = catchAsync(async (req, res, next) => {
  const { paymentId, orderId, razorpaySignature } = req.body;

  if (!paymentId || !orderId) {
    return next(new AppError("Payment ID and Order ID are required", 400));
  }

  // Find the payment by transaction ID
  const payment = await Payment.findOne({
    "paymentDetails.razorpayOrderId": orderId,
  });

  if (!payment) {
    return next(new AppError("Payment not found", 404));
  }

  // Verify the Razorpay signature (security check)
  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  if (generatedSignature !== razorpaySignature) {
    payment.status = "failed";
    await payment.save();
    return next(new AppError("Payment verification failed", 400));
  }

  // Update payment status to completed
  payment.status = "completed";
  payment.paymentDetails = {
    ...payment.paymentDetails,
    razorpayPaymentId: paymentId,
    razorpaySignature,
  };
  await payment.save();

  res.status(200).json({
    status: "success",
    message: "Payment verified successfully",
    data: {
      payment,
      examId: payment.examId,
    },
  });
});

export default verifyPayment;
