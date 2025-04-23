// // src/controllers/payment/check-access.js
// import { catchAsync, AppError } from "../../utils/errorHandler.js";
// import { getUserId } from "../../utils/cachedDbQueries.js";
// import Payment from "../../models/payment.models.js";

// const checkExamAccess = catchAsync(async (req, res, next) => {
//   const { examId } = req.params;

//   if (!examId) {
//     return next(new AppError("Exam ID is required", 400));
//   }

//   // Get user ID from the request
//   const userId = await getUserId(req.user.sub);
//   if (!userId) {
//     return next(new AppError("User not found", 404));
//   }

//   // Check if user has valid access to this exam
//   const validPayment = await Payment.findOne({
//     userId,
//     examId,
//     status: "completed",
//     validUntil: { $gt: new Date() },
//   });

//   const hasAccess = !!validPayment;

//   res.status(200).json({
//     status: "success",
//     data: {
//       hasAccess,
//       payment: validPayment || null,
//     },
//   });
// });

// export default checkExamAccess;

// src/controllers/payment/check-access.js
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import Payment from "../../models/payment.models.js";
import { BUNDLE_DEFINITIONS } from "../../utils/bundleDefinitions.js";

const checkExamAccess = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from the request
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Check if the examId is a bundle ID (matches a defined bundle)
  const isBundle = BUNDLE_DEFINITIONS.some((def) => def.id === examId);

  if (isBundle) {
    // For bundles, we need to check if the user has access to the bundle itself
    const validBundlePayment = await Payment.findOne({
      userId,
      examId,
      status: "completed",
      validUntil: { $gt: new Date() },
      "paymentDetails.isBundle": true,
    });

    const hasAccess = !!validBundlePayment;

    return res.status(200).json({
      status: "success",
      data: {
        hasAccess,
        payment: validBundlePayment || null,
        isBundle: true,
      },
    });
  }

  // Check if user has valid access to this exam directly
  const validDirectPayment = await Payment.findOne({
    userId,
    examId,
    status: "completed",
    validUntil: { $gt: new Date() },
  });

  if (validDirectPayment) {
    return res.status(200).json({
      status: "success",
      data: {
        hasAccess: true,
        payment: validDirectPayment,
        isBundle: false,
      },
    });
  }

  // If not found directly, check if the exam is part of any bundle the user has access to
  const bundlePayment = await Payment.findOne({
    userId,
    status: "completed",
    validUntil: { $gt: new Date() },
    "paymentDetails.partOfBundle": true,
    "paymentDetails.mainBundleId": { $exists: true },
    examId: examId,
  });

  const hasAccessThroughBundle = !!bundlePayment;

  res.status(200).json({
    status: "success",
    data: {
      hasAccess: hasAccessThroughBundle,
      payment: bundlePayment || null,
      throughBundle: hasAccessThroughBundle,
      bundleId: hasAccessThroughBundle
        ? bundlePayment.paymentDetails.mainBundleId
        : null,
    },
  });
});

export default checkExamAccess;
