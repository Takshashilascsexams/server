import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import Exam from "../../models/exam.models.js";
import Payment from "../../models/payment.models.js";
import { v4 as uuidv4 } from "uuid";
import Razorpay from "razorpay";
import {
  BUNDLE_DEFINITIONS,
  createBundleFromExams,
} from "../../utils/bundleDefinitions.js";

const createPayment = catchAsync(async (req, res, next) => {
  const { examId, isBundle = false } = req.body;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from the request
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Special handling for bundles
  let exam;
  let bundledExams = [];

  if (isBundle) {
    // First, check if this user already has access to this bundle
    const existingBundlePayment = await Payment.findOne({
      userId,
      examId,
      status: "completed",
      validUntil: { $gt: new Date() },
      "paymentDetails.isBundle": true,
    });

    if (existingBundlePayment) {
      return res.status(200).json({
        status: "success",
        message: "You already have access to this bundle",
        hasAccess: true,
        data: {
          payment: existingBundlePayment,
        },
      });
    }

    // Find the bundle definition that matches this examId
    const bundleDef = BUNDLE_DEFINITIONS.find((def) => def.id === examId);
    if (!bundleDef) {
      return next(new AppError("Invalid bundle ID", 400));
    }

    // Fetch all exams with the matching bundle tag
    bundledExams = await Exam.find({
      bundleTags: bundleDef.tag,
      isActive: true,
    })
      .select("_id title price discountPrice duration totalMarks")
      .lean();

    if (bundledExams.length < (bundleDef.minExams || 2)) {
      return next(
        new AppError("Not enough exams available in this bundle", 404)
      );
    }

    // Create a bundle object
    const userAccessMap = {}; // Empty since we're checking for purchase, not displaying
    exam = createBundleFromExams(bundledExams, bundleDef, userAccessMap);
  } else {
    // Find the individual exam
    exam = await Exam.findById(examId);
    if (!exam) {
      return next(new AppError("Exam not found", 404));
    }

    // Check if the exam is premium
    if (!exam.isPremium) {
      return next(new AppError("This exam is not a premium exam", 400));
    }

    // Check if the user already has active access to this exam
    const existingPayment = await Payment.findOne({
      userId,
      examId,
      status: "completed",
      validUntil: { $gt: new Date() },
    });

    if (existingPayment) {
      return res.status(200).json({
        status: "success",
        message: "You already have access to this exam",
        hasAccess: true,
        data: {
          payment: existingPayment,
        },
      });
    }
  }

  // Calculate the final price (use discount price if available)
  const finalPrice =
    exam.discountPrice && exam.discountPrice < exam.price
      ? exam.discountPrice
      : exam.price;

  // Generate a unique order ID
  const orderId = `order_${uuidv4().replace(/-/g, "")}`;

  // Initialize Razorpay (example payment gateway)
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_SECRET_KEY,
  });

  // Create Razorpay order
  const razorpayOrder = await razorpay.orders.create({
    amount: finalPrice * 100, // Convert to paise
    currency: "INR",
    receipt: orderId,
    notes: {
      examId: examId,
      userId: userId.toString(),
      isBundle: isBundle,
    },
  });

  // Create a pending payment record
  const payment = await Payment.create({
    userId,
    examId,
    transactionId: orderId,
    amount: finalPrice,
    currency: "INR",
    status: "pending",
    paymentMethod: "razorpay",
    paymentDetails: {
      razorpayOrderId: razorpayOrder.id,
      isBundle: isBundle,
      bundledExams: isBundle ? bundledExams.map((e) => e._id) : undefined,
      bundleTag: isBundle ? exam.bundleTag : undefined,
    },
    // Calculate validUntil date (current date + access period days)
    validUntil: new Date(
      Date.now() + (exam.accessPeriod || 30) * 24 * 60 * 60 * 1000
    ),
  });

  res.status(200).json({
    status: "success",
    message: isBundle ? "Bundle payment initiated" : "Payment initiated",
    data: {
      payment,
      razorpayOrder,
      paymentUrl: `${process.env.RAZORPAY_CHECKOUT_URL}?order_id=${razorpayOrder.id}`,
      isBundle,
      bundledExams: isBundle
        ? bundledExams.map((e) => ({ id: e._id, title: e.title }))
        : undefined,
    },
  });
});

export default createPayment;
