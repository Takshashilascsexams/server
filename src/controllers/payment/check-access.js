import { AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import Payment from "../../models/payment.models.js";
import { BUNDLE_DEFINITIONS } from "../../utils/bundleDefinitions.js";
import { paymentService } from "../../services/redisService.js";

/**
 * Controller to check if user has access to an exam
 * Returns a promise that resolves to the access result
 */

const checkExamAccess = async (req, res, next) => {
  try {
    const { examId } = req.params;

    if (!examId) {
      if (next) next(new AppError("Exam ID is required", 400));
      return { status: "error", message: "Exam ID is required" };
    }

    // Get user ID from the request
    const userId = await getUserId(req.user.sub);
    if (!userId) {
      if (next) next(new AppError("User not found", 404));
      return { status: "error", message: "User not found" };
    }

    // Prepare response object
    const responseData = {
      status: "success",
      data: {
        hasAccess: false,
        payment: null,
        isBundle: false,
      },
    };

    // Detect if this is an internal call by checking if res is null or not a function
    const isInternalCall = !res || typeof res.status !== "function";

    // First check if user access is cached
    try {
      const cachedAccess = await paymentService.getUserExamAccess(userId);

      if (cachedAccess && cachedAccess[examId] !== undefined) {
        responseData.data.hasAccess = cachedAccess[examId];

        // Always return data for internal calls
        if (isInternalCall) {
          return responseData;
        }

        return res.status(200).json(responseData);
      }
    } catch (error) {
      console.error("Error checking cached access:", error);
      // Continue to database query on cache error
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

      responseData.data.hasAccess = !!validBundlePayment;
      responseData.data.payment = validBundlePayment || null;
      responseData.data.isBundle = true;

      // Update cache for future requests
      try {
        let currentAccessMap = await paymentService.getUserExamAccess(
          userId.toString()
        );
        if (!currentAccessMap) {
          currentAccessMap = {};
        }
        currentAccessMap[examId] = responseData.data.hasAccess;
        await paymentService.setUserExamAccess(
          userId.toString(),
          currentAccessMap,
          15 * 60
        );
      } catch (error) {
        console.error("Error updating access cache:", error);
      }

      // Always return data for internal calls
      if (isInternalCall) {
        return responseData;
      }

      return res.status(200).json(responseData);
    }

    // Check if user has valid access to this exam directly
    const validDirectPayment = await Payment.findOne({
      userId,
      examId,
      status: "completed",
      validUntil: { $gt: new Date() },
    });

    if (validDirectPayment) {
      responseData.data.hasAccess = true;
      responseData.data.payment = validDirectPayment;

      // Update cache for future requests
      try {
        let currentAccessMap = await paymentService.getUserExamAccess(
          userId.toString()
        );
        if (!currentAccessMap) {
          currentAccessMap = {};
        }
        currentAccessMap[examId] = true;
        await paymentService.setUserExamAccess(
          userId.toString(),
          currentAccessMap,
          15 * 60
        );
      } catch (error) {
        console.error("Error updating access cache:", error);
      }

      // Always return data for internal calls
      if (isInternalCall) {
        return responseData;
      }

      return res.status(200).json(responseData);
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

    responseData.data.hasAccess = hasAccessThroughBundle;
    responseData.data.payment = bundlePayment || null;
    responseData.data.throughBundle = hasAccessThroughBundle;
    responseData.data.bundleId = hasAccessThroughBundle
      ? bundlePayment.paymentDetails.mainBundleId
      : null;

    // Update cache for future requests
    try {
      let currentAccessMap = await paymentService.getUserExamAccess(
        userId.toString()
      );
      if (!currentAccessMap) {
        currentAccessMap = {};
      }
      currentAccessMap[examId] = hasAccessThroughBundle;
      await paymentService.setUserExamAccess(
        userId.toString(),
        currentAccessMap,
        15 * 60
      );
    } catch (error) {
      console.error("Error updating access cache:", error);
    }

    // Always return data for internal calls
    if (isInternalCall) {
      return responseData;
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Error in checkExamAccess:", error);

    // Handle errors differently based on call type
    if (!res || typeof res.status !== "function") {
      return {
        status: "error",
        message: error.message || "An error occurred while checking access",
      };
    }

    if (next) {
      return next(
        new AppError(error.message || "Failed to check exam access", 500)
      );
    }

    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to check exam access",
    });
  }
};

// Wrap with catchAsync for Express middleware compatibility
export default checkExamAccess;
