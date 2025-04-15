import { catchAsync, AppError } from "../../utils/errorHandler.js";
import Payment from "../../models/payment.models.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { paymentService, examService } from "../../services/redisService.js";
import crypto from "crypto";

const verifyPayment = catchAsync(async (req, res, next) => {
  const {
    paymentId,
    orderId,
    razorpaySignature,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  } = req.body;

  const payment_id = paymentId || razorpay_payment_id;
  const order_id = orderId || razorpay_order_id;
  const signature = razorpaySignature || razorpay_signature;

  if (!payment_id || !order_id) {
    return next(new AppError("Payment ID and Order ID are required", 400));
  }

  // Find the payment by transaction ID
  const payment = await Payment.findOne({
    "paymentDetails.razorpayOrderId": order_id,
  });

  if (!payment) {
    return next(new AppError("Payment not found", 404));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Verify the Razorpay signature (security check)
  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET_KEY)
    .update(`${order_id}|${payment_id}`)
    .digest("hex");

  if (generatedSignature !== signature) {
    payment.status = "failed";
    await payment.save();
    return next(new AppError("Payment verification failed", 400));
  }

  // Update payment status to completed
  payment.status = "completed";
  payment.paymentDetails = {
    ...payment.paymentDetails,
    razorpayPaymentId: payment_id,
    razorpaySignature: signature,
  };
  await payment.save();

  // IMPROVED APPROACH: Update the user's access cache instead of clearing it
  let currentAccessMap = await paymentService.getUserExamAccess(
    userId.toString()
  );
  if (!currentAccessMap) {
    currentAccessMap = {};
  }

  // Add the new exam access
  currentAccessMap[payment.examId.toString()] = true;

  // Update the cache with the merged access rights
  await paymentService.setUserExamAccess(
    userId.toString(),
    currentAccessMap,
    // 24 * 60 * 60 // cache access for 24 hrs
    2 * 60 // cache access for 24 hrs
  );

  // IMPORTANT: Clear only the user-specific categorized exams cache
  const cacheKey = `categorized:${userId.toString()}`;
  await examService.clearUserSpecificExamsCache(cacheKey);

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
