import Exam from "../../../models/exam.models.js";
import Payment from "../../../models/payment.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService, paymentService } from "../../../services/redisService.js";
import { examCategory } from "../../../utils/arrays.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";

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
    const cachedData = await examService.getCachedData(cacheKey);

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

    // Get total count of active exams
    const total = await Exam.countDocuments(baseQuery);

    // Fetch all active exams with pagination
    const exams = await Exam.find(baseQuery)
      .sort({ createdAt: -1 })
      .select(
        "title description category duration totalMarks difficultyLevel passMarkPercentage isFeatured isPremium price discountPrice accessPeriod"
      )
      .lean();

    // Get all exam IDs that are premium
    const premiumExamIds = exams
      .filter((exam) => exam.isPremium)
      .map((exam) => exam._id);

    // If there are premium exams, check user's access
    let userAccessMap = {};
    if (premiumExamIds.length > 0) {
      // Try to get from cache first
      userAccessMap = await paymentService.getUserExamAccess(userId);

      // If not in cache or we need fresh data, query the database
      if (!userAccessMap) {
        const validPayments = await Payment.find({
          userId,
          examId: { $in: premiumExamIds },
          status: "completed",
          // Only check that validUntil is in the future or doesn't exist
          $or: [
            { validUntil: { $gt: new Date() } },
            { validUntil: { $exists: false } },
          ],
        })
          .select("examId")
          .lean();

        // Create a map of exam IDs to access status
        userAccessMap = {};
        validPayments.forEach((payment) => {
          userAccessMap[payment.examId.toString()] = true;
        });

        // Cache this access map for future requests (with a short TTL)
        await paymentService.setUserExamAccess(userId, userAccessMap, 5 * 60); // 5 minute TTL
      }
    }

    // Group exams by category and add hasAccess property
    exams.forEach((exam) => {
      // Convert _id to string for comparison
      const examId = exam._id.toString();

      // Add hasAccess flag
      exam.hasAccess = exam.isPremium ? !!userAccessMap[examId] : true;

      // Add to original category
      if (categorizedExams[exam.category]) {
        categorizedExams[exam.category].push(exam);
      }

      // Also add to FEATURED array if premium or featured
      if (exam.isPremium === true || exam.isFeatured === true) {
        categorizedExams["FEATURED"].push(exam);
      }
    });

    console.log("categorized:", userAccessMap);

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
      await examService.setCachedData(cacheKey, responseData, 15 * 60);
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
