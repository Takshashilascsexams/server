import Exam from "../../../models/exam.models.js";
import Payment from "../../../models/payment.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService, paymentService } from "../../../services/redisService.js";
import { examCategory } from "../../../utils/arrays.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  BUNDLE_DEFINITIONS,
  createBundleFromExams,
} from "../../../utils/bundleDefinitions.js";

const getCategorizedExams = catchAsync(async (req, res, next) => {
  // Get pagination parameters with defaults
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 10;

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Create a cache key that includes the user ID
  const cacheKey = `categorized:${userId}`;

  try {
    // Check if we have cached data for this specific user
    const cachedData = await examService.getUserSpecificExamsCache(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        pagination: cachedData.pagination,
        data: cachedData.data,
      });
    }
  } catch (cacheError) {
    // Log cache error but continue to database query
    console.error("Cache error in getCategorizedExams:", cacheError);
  }

  // If we get here, we need to fetch from the database
  // Only fetch active exams for users
  const baseQuery = { isActive: true };

  try {
    // Create an object to store exams by category
    const categorizedExams = {};

    // Initialize with all possible categories from the enum
    examCategory.forEach((category) => {
      categorizedExams[category] = [];
    });

    // Also create a special FEATURED category for premium or featured exams
    categorizedExams["FEATURED"] = [];

    // Create a new BUNDLE category for grouped exams
    categorizedExams["BUNDLE"] = [];

    // Get total count of active exams
    const total = await Exam.countDocuments(baseQuery);

    // Fetch all active exams with pagination
    const exams = await Exam.find(baseQuery)
      .sort({ createdAt: -1 })
      .select(
        "title description category duration totalMarks difficultyLevel passMarkPercentage isFeatured isPremium price discountPrice accessPeriod bundleTags"
      )
      .lean();

    // Get all exam IDs that are premium
    const premiumExamIds = exams
      .filter((exam) => exam.isPremium)
      .map((exam) => exam._id);

    // If there are premium exams, check user's access
    let userAccessMap = {};
    if (premiumExamIds.length > 0) {
      // Get the cached access map (for efficiency)
      userAccessMap = await paymentService.getUserExamAccess(userId);

      // ALWAYS query the database for verified payments, but limit to premium exams
      const validPayments = await Payment.find({
        userId,
        examId: { $in: premiumExamIds },
        status: "completed",
        $or: [
          { validUntil: { $gt: new Date() } },
          { validUntil: { $exists: false } },
        ],
      })
        .select("examId")
        .lean();

      // Create a map of exam IDs to access status
      const dbAccessMap = {};
      validPayments.forEach((payment) => {
        dbAccessMap[payment.examId.toString()] = true;
      });

      // Merge the cached map with the database results (database takes precedence)
      userAccessMap = { ...userAccessMap, ...dbAccessMap };

      // Update the cache with the merged results (longer TTL)
      await paymentService.setUserExamAccess(
        userId,
        userAccessMap,
        24 * 60 * 60 // cache exams access for 24hrs
      );
    }

    // Create bundles based on bundle tags
    const bundles = [];

    // For each bundle definition, find exams with matching tags
    BUNDLE_DEFINITIONS.forEach((bundleDef) => {
      // Filter exams with this bundle tag
      const examsWithTag = exams.filter(
        (exam) => exam.bundleTags && exam.bundleTags.includes(bundleDef.tag)
      );

      // Only create the bundle if we have enough exams
      const minExams = bundleDef.minExams || 2;
      if (examsWithTag.length >= minExams) {
        // Create a bundle using the helper function
        const bundle = createBundleFromExams(
          examsWithTag,
          bundleDef,
          userAccessMap
        );
        bundles.push(bundle);
      }
    });

    // Sort bundles by priority
    bundles.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Add bundles to the BUNDLE category
    categorizedExams["BUNDLE"] = bundles;

    // Group exams by category and add hasAccess property
    exams.forEach((exam) => {
      // Mark exams that are part of a bundle
      bundles.forEach((bundle) => {
        if (exam.bundleTags && exam.bundleTags.includes(bundle.bundleTag)) {
          exam.isPartOfBundle = true;
          exam.bundleId = bundle._id;
        }
      });

      // Convert _id to string for comparison
      const examId = exam._id.toString();

      // Add hasAccess flag
      exam.hasAccess = exam.isPremium ? !!userAccessMap[examId] : true;

      // Add to original category
      if (categorizedExams[exam.category]) {
        categorizedExams[exam.category].push(exam);
      }

      // Also add to FEATURED array if premium or featured
      if (
        (exam.isPremium === true || exam.isFeatured === true) &&
        !exam.isPartOfBundle
      ) {
        categorizedExams["FEATURED"].push(exam);
      }
    });

    // Prepare response data
    const responseData = {
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
      data: {
        categorizedExams,
      },
    };

    // Cache the result for 15 minutes (shorter TTL since it includes user-specific access data)
    try {
      await examService.setUserSpecificExamsCache(
        cacheKey,
        responseData,
        15 * 60
      );
    } catch (cacheSetError) {
      console.error("Failed to cache categorized exams:", cacheSetError);
    }

    // Send response
    return res.status(200).json({
      status: "success",
      fromCache: false,
      pagination: responseData.pagination,
      data: responseData.data,
    });
  } catch (dbError) {
    console.error("Database error in getCategorizedExams:", dbError);
    return next(new AppError("Failed to fetch exams", 500));
  }
});

export default getCategorizedExams;
