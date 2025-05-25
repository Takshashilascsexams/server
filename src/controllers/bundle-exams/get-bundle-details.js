import Exam from "../../models/exam.models.js";
import Payment from "../../models/payment.models.js";
import { catchAsync, AppError } from "../../utils/errorHandler.js";
import { getUserId } from "../../utils/cachedDbQueries.js";
import { examService, paymentService } from "../../services/redisService.js";
import { BUNDLE_DEFINITIONS } from "../../utils/bundleDefinitions.js";

/**
 * Controller to fetch a bundle and its bundled exams
 * - Checks user access to the bundle (free bundles automatically granted access)
 * - Returns bundle details and all exams within it
 * - Uses caching for performance optimization
 */

const getBundleDetails = catchAsync(async (req, res, next) => {
  const { bundleId } = req.params;

  if (!bundleId) {
    return next(new AppError("Bundle ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // **UPDATED: Convert userId to string for cache operations**
  const userIdString = userId.toString();

  try {
    // Try to get bundle data from cache first
    const cachedData = await examService.getBundleCache(bundleId, userIdString);

    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (cacheError) {
    // Log cache error but continue to database query
    console.error("Cache error in getBundleDetails:", cacheError);
  }

  try {
    // Verify this is a valid bundle ID from our definitions
    const bundleDefinition = BUNDLE_DEFINITIONS.find(
      (def) => def.id === bundleId
    );

    if (!bundleDefinition) {
      return next(new AppError("Invalid bundle ID", 404));
    }

    // **UPDATED: Handle free vs premium bundle access logic**
    let hasAccess = false;

    if (bundleDefinition.isPremium === false) {
      // **UPDATED: Free bundles automatically grant access**
      hasAccess = true;
    } else {
      // **UPDATED: Premium bundles require payment verification**
      const bundleAccess = await Payment.findOne({
        userId,
        examId: bundleId,
        status: "completed",
        validUntil: { $gt: new Date() },
      }).lean();

      hasAccess = !!bundleAccess;

      if (!hasAccess) {
        return next(new AppError("Access denied for this bundle", 401));
      }
    }

    // Fetch all exams with the bundle tag
    const bundledExams = await Exam.find({
      bundleTags: bundleDefinition.tag,
      isActive: true,
    })
      .select(
        "_id title description category duration totalMarks difficultyLevel passMarkPercentage isFeatured isPremium"
      )
      .lean();

    if (bundledExams.length === 0) {
      return next(new AppError("No active exams found in this bundle", 404));
    }

    // Format the bundle data
    // Using total values calculated from the bundled exams
    const totalDuration = bundledExams.reduce(
      (total, exam) => total + exam.duration,
      0
    );
    const totalMarks = bundledExams.reduce(
      (total, exam) => total + exam.totalMarks,
      0
    );

    // **UPDATED: Handle pricing logic for free vs premium bundles**
    let originalPrice = 0;
    let discountedPrice = 0;

    if (bundleDefinition.isPremium !== false) {
      // Premium bundle pricing logic
      originalPrice =
        bundleDefinition.price ||
        bundledExams.reduce((total, exam) => total + (exam.price || 0), 0);

      discountedPrice = Math.round(
        originalPrice * (1 - (bundleDefinition.discountPercentage || 0) / 100)
      );
    } else {
      // Free bundle pricing logic
      originalPrice = bundleDefinition.price || 0;
      discountedPrice = 0;
    }

    // Create the bundle object
    const bundle = {
      _id: bundleId,
      title: bundleDefinition.title,
      description: bundleDefinition.description,
      category: "BUNDLE",
      duration: totalDuration,
      totalMarks: totalMarks,
      difficultyLevel: "MEDIUM", // Default or could be calculated
      passMarkPercentage: 35, // Default or could be from bundle definition
      isActive: true,
      isFeatured: bundleDefinition.featured !== false,
      isPremium: bundleDefinition.isPremium !== false, // **UPDATED: Use bundle definition instead of hardcoded true**
      price: originalPrice,
      discountPrice: discountedPrice,
      accessPeriod: bundleDefinition.accessPeriod || 30,
      hasAccess,
      isBundle: true,
      bundleTag: bundleDefinition.tag,
      bundledExams,
    };

    // Prepare the response data
    const responseData = {
      bundle,
    };

    // Cache the result for 15 minutes
    try {
      await examService.setBundleCache(
        bundleId,
        userIdString,
        responseData,
        15 * 60
      );
    } catch (cacheSetError) {
      console.error("Failed to cache bundle details:", cacheSetError);
    }

    // Send response
    return res.status(200).json({
      status: "success",
      fromCache: false,
      data: responseData,
    });
  } catch (error) {
    console.error("Database error in getBundleDetails:", error);
    return next(new AppError("Failed to fetch bundle details", 500));
  }
});

export default getBundleDetails;
