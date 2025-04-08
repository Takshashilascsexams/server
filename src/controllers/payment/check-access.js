// src/controllers/payment/check-access.js
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import Payment from "../../models/payment.models.js";

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

  // Check if user has valid access to this exam
  const validPayment = await Payment.findOne({
    userId,
    examId,
    status: "completed",
    validUntil: { $gt: new Date() },
  });

  const hasAccess = !!validPayment;

  res.status(200).json({
    status: "success",
    data: {
      hasAccess,
      payment: validPayment || null,
    },
  });
});

export default checkExamAccess;
