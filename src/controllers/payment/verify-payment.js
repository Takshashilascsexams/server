// import { catchAsync, AppError } from "../../utils/errorHandler.js";
// import Payment from "../../models/payment.models.js";
// import { getUserId } from "../../utils/cachedDbQueries.js";
// import { paymentService, examService } from "../../services/redisService.js";
// import crypto from "crypto";

// const verifyPayment = catchAsync(async (req, res, next) => {
//   const {
//     paymentId,
//     orderId,
//     razorpaySignature,
//     razorpay_payment_id,
//     razorpay_order_id,
//     razorpay_signature,
//   } = req.body;

//   const payment_id = paymentId || razorpay_payment_id;
//   const order_id = orderId || razorpay_order_id;
//   const signature = razorpaySignature || razorpay_signature;

//   if (!payment_id || !order_id) {
//     return next(new AppError("Payment ID and Order ID are required", 400));
//   }

//   // Find the payment by transaction ID
//   const payment = await Payment.findOne({
//     "paymentDetails.razorpayOrderId": order_id,
//   });

//   if (!payment) {
//     return next(new AppError("Payment not found", 404));
//   }

//   // Get user ID from token
//   const userId = await getUserId(req.user.sub);
//   if (!userId) {
//     return next(new AppError("User not found", 404));
//   }

//   // Verify the Razorpay signature (security check)
//   const generatedSignature = crypto
//     .createHmac("sha256", process.env.RAZORPAY_SECRET_KEY)
//     .update(`${order_id}|${payment_id}`)
//     .digest("hex");

//   if (generatedSignature !== signature) {
//     payment.status = "failed";
//     await payment.save();
//     return next(new AppError("Payment verification failed", 400));
//   }

//   // Update payment status to completed
//   payment.status = "completed";
//   payment.paymentDetails = {
//     ...payment.paymentDetails,
//     razorpayPaymentId: payment_id,
//     razorpaySignature: signature,
//   };
//   await payment.save();

//   // IMPROVED APPROACH: Update the user's access cache instead of clearing it
//   let currentAccessMap = await paymentService.getUserExamAccess(
//     userId.toString()
//   );
//   if (!currentAccessMap) {
//     currentAccessMap = {};
//   }

//   // Add the new exam access
//   currentAccessMap[payment.examId.toString()] = true;

//   // Update the cache with the merged access rights
//   await paymentService.setUserExamAccess(
//     userId.toString(),
//     currentAccessMap,
//     // 24 * 60 * 60 // cache access for 24 hrs
//     2 * 60 // cache access for 24 hrs
//   );

//   // IMPORTANT: Clear only the user-specific categorized exams cache
//   const cacheKey = `categorized:${userId.toString()}`;
//   await examService.clearUserSpecificExamsCache(cacheKey);

//   res.status(200).json({
//     status: "success",
//     message: "Payment verified successfully",
//     data: {
//       payment,
//       examId: payment.examId,
//     },
//   });
// });

// export default verifyPayment;

import { catchAsync, AppError } from "../../utils/errorHandler.js";
import Payment from "../../models/payment.models.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { paymentService, examService } from "../../services/redisService.js";
import crypto from "crypto";
import mongoose from "mongoose";

const verifyPayment = catchAsync(async (req, res, next) => {
  const {
    paymentId,
    orderId,
    razorpaySignature,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    examId,
    isBundle = false,
    bundledExams = [], // Array of exam IDs included in the bundle
  } = req.body;

  const payment_id = paymentId || razorpay_payment_id;
  const order_id = orderId || razorpay_order_id;
  const signature = razorpaySignature || razorpay_signature;

  if (!payment_id || !order_id) {
    return next(new AppError("Payment ID and Order ID are required", 400));
  }

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
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

  // Start a session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update payment status to completed
    payment.status = "completed";
    payment.paymentDetails = {
      ...payment.paymentDetails,
      razorpayPaymentId: payment_id,
      razorpaySignature: signature,
      isBundle: isBundle,
      bundledExams: isBundle ? bundledExams : undefined,
    };
    await payment.save({ session });

    // IMPROVED APPROACH: Update the user's access cache
    let currentAccessMap = await paymentService.getUserExamAccess(
      userId.toString()
    );
    if (!currentAccessMap) {
      currentAccessMap = {};
    }

    // If it's a bundle, create payments for all bundled exams
    if (isBundle && bundledExams && bundledExams.length > 0) {
      const bundlePayments = [];

      // Calculate access period end date
      const accessPeriod = payment.validUntil
        ? (new Date(payment.validUntil) - new Date()) / (24 * 60 * 60 * 1000)
        : 30; // Default 30 days for bundles

      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + accessPeriod);

      // Create a payment record for each exam in the bundle
      for (const bundledExamId of bundledExams) {
        // Skip if already processed
        if (currentAccessMap[bundledExamId]) continue;

        bundlePayments.push({
          userId,
          examId: bundledExamId,
          transactionId: `${order_id}-${bundledExamId}`,
          amount: 0, // Individual exam cost not relevant for bundle payment
          currency: "INR",
          status: "completed",
          paymentMethod: "razorpay",
          paymentDetails: {
            bundlePaymentId: payment._id,
            partOfBundle: true,
            mainBundleId: examId,
          },
          validUntil: validUntil,
        });

        // Add to access map
        currentAccessMap[bundledExamId] = true;
      }

      // Save all bundle payments in bulk
      if (bundlePayments.length > 0) {
        await Payment.insertMany(bundlePayments, { session });
      }
    }

    // Add the original exam access (the bundle itself)
    currentAccessMap[payment.examId.toString()] = true;

    // Commit the transaction
    await session.commitTransaction();
    session.endSession();

    // Update the cache with the merged access rights
    await paymentService.setUserExamAccess(
      userId.toString(),
      currentAccessMap,
      // 24 * 60 * 60 // cache access for 24 hrs
      2 * 60 // cache access for 2 mins (for testing, increase in production)
    );

    // IMPORTANT: Clear only the user-specific categorized exams cache
    const cacheKey = `categorized:${userId.toString()}`;
    await examService.clearUserSpecificExamsCache(cacheKey);

    res.status(200).json({
      status: "success",
      message: isBundle
        ? "Bundle purchase verified successfully"
        : "Payment verified successfully",
      data: {
        payment,
        examId: payment.examId,
        isBundle,
        bundledExams: isBundle ? bundledExams : undefined,
      },
    });
  } catch (error) {
    // If an error occurs, abort the transaction
    await session.abortTransaction();
    session.endSession();

    console.error("Payment verification error:", error);
    return next(new AppError("Payment verification failed", 500));
  }
});

export default verifyPayment;
