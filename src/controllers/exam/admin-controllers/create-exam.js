import Exam from "../../../models/exam.models.js";
import ExamAnalytics from "../../../models/examAnalytics.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  examService,
  analyticsService,
} from "../../../services/redisService.js";

const createExam = catchAsync(async (req, res, next) => {
  const {
    title,
    description,
    duration,
    totalQuestions,
    totalMarks,
    hasNegativeMarking,
    negativeMarkingValue,
    passMarkPercentage,
    difficultyLevel,
    category,
    allowNavigation,
    allowMultipleAttempts,
    maxAttempt = 1,
    isPremium,
    price,
    discountPrice,
    accessPeriod,
    isFeatured,
    isPartOfBundle = false,
    bundleTag = "",
  } = req.body;

  if (
    [
      title,
      description,
      duration,
      totalQuestions,
      totalMarks,
      hasNegativeMarking,
      negativeMarkingValue,
      passMarkPercentage,
      difficultyLevel,
      category,
      allowNavigation,
      allowMultipleAttempts,
      maxAttempt,
      isPremium,
      price,
      discountPrice,
      accessPeriod,
      isFeatured,
    ].some((value) => value === null || value === undefined)
  ) {
    return next(
      new AppError("Please provide all the fields for a new exam", 400)
    );
  }

  // Validate attempt-related fields
  const parsedMaxAttempt = parseInt(maxAttempt);
  const isMultipleAttemptsAllowed =
    allowMultipleAttempts === "Yes" || allowMultipleAttempts === true;

  if (parsedMaxAttempt < 1 || parsedMaxAttempt > 2) {
    return next(
      new AppError(
        "Minimum attempt should be 1 and maximum attempt should be 2",
        400
      )
    );
  }

  if (!isMultipleAttemptsAllowed && parsedMaxAttempt > 1) {
    return next(
      new AppError(
        "When multiple attempts are not allowed, maximum attempts should be 1",
        400
      )
    );
  }

  if (isMultipleAttemptsAllowed && parsedMaxAttempt === 1) {
    return next(
      new AppError(
        "When multiple attempts are allowed, maximum attempts should be greater than 1",
        400
      )
    );
  }

  // Validate premium exam has correct price
  if (isPremium === true && (!price || parseFloat(price) <= 0)) {
    return next(
      new AppError("Premium exams must have a price greater than 0", 400)
    );
  }

  // Validate discount price is less than regular price
  if (discountPrice && parseFloat(discountPrice) >= parseFloat(price)) {
    return next(
      new AppError("Discount price must be less than regular price", 400)
    );
  }

  if (isPartOfBundle && !bundleTag) {
    return next(new AppError("A bundle tag is required for bundle exams", 400));
  }

  const userId = await getUserId(req.user.sub);

  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  const newExamBody = {
    title,
    description,
    duration: parseInt(duration),
    totalQuestions: parseInt(totalQuestions),
    totalMarks: parseInt(totalMarks),
    hasNegativeMarking: hasNegativeMarking === "Yes" ? true : false,
    negativeMarkingValue: parseInt(negativeMarkingValue),
    passMarkPercentage: parseInt(passMarkPercentage),
    difficultyLevel,
    category,
    allowNavigation: allowNavigation === "Yes" ? true : false,
    allowMultipleAttempts: isMultipleAttemptsAllowed,
    maxAttempt: parsedMaxAttempt,
    isPremium: isPremium === "Yes" ? true : false,
    price: price ? parseFloat(price) : 0,
    discountPrice: discountPrice ? parseFloat(discountPrice) : 0,
    accessPeriod,
    isFeatured: isFeatured === "Yes" ? true : false,
    createdBy: userId,
    bundleTags: [bundleTag],
  };

  // Create the test series
  const newExam = await Exam.create(newExamBody);

  // Initialize analytics for this test series
  const newExamAnalyticsBody = {
    examId: newExam._id,
    totalAttempted: 0,
    totalCompleted: 0,
    highestScore: 0,
    lowestScore: 0,
    averageScore: 0,
    passCount: 0,
    failCount: 0,
    passPercentage: 0,
    failPercentage: 0,
  };

  const examAnalytics = await ExamAnalytics.create(newExamAnalyticsBody);

  // Cache the new exam and its analytics
  await Promise.all([
    examService.setExam(newExam._id.toString(), newExam.toJSON()),
    examService.setExamExists(newExam._id.toString(), true),
    analyticsService.setAnalytics(
      newExam._id.toString(),
      examAnalytics.toJSON()
    ),
  ]);

  // Comprehensive cache clearing for all affected controllers
  try {
    await Promise.allSettled([
      // 1. Clear getExamDashboard cache - admin dashboard cache
      examService.clearPattern(
        examService.examCache,
        "admin:dashboard:exams:*"
      ),

      // 2. Clear getExamById cache - individual exam cache for editing
      examService.clearPattern(examService.examCache, "admin:exam:*"),

      // 3. Clear getExamDetails cache - detailed exam analytics cache
      examService.clearPattern(examService.examCache, "admin:exam:details:*"),

      // 4. Clear getCategorizedExams cache - user-specific categorized exams (FIXED)
      // This controller uses getUserSpecificExamsCache which has pattern "categorized:shardId:userId"
      examService.clearCategorizedExamsCache(), // This clears categorized:*:* pattern for all 16 shards

      // Additional clear for any direct categorized cache keys
      examService.clearPattern(examService.examCache, "categorized:*"), // Clear all categorized cache patterns

      // 5. Clear getLatestPublishedExams cache - latest exams for users
      examService.clearLatestExamsCache(), // This clears latest:* pattern

      // 6. Clear getBundleDetails cache - bundle-specific cache for all users
      examService.clearAllBundleCache(), // This clears bundle:*:*:* pattern

      // 7. Clear additional patterns used by getCategorizedExams
      examService.clearPattern(examService.examCache, "categorized:*"), // Clear all sharded user-specific cache

      // 8. Clear general exam cache patterns
      examService.clearPattern(examService.examCache, "exam:*"),
      examService.clearPattern(examService.examCache, "latest:*"),

      // 9. Clear user-specific exam access cache (since new exam affects access)
      examService.clearPattern(examService.examCache, "access:*"),

      // 10. Clear any remaining cache patterns that might be used
      examService.clearPattern(examService.examCache, "latest:published:*"), // getLatestPublishedExams specific pattern
    ]);
  } catch (cacheError) {
    console.error("Failed to clear comprehensive exam cache:", cacheError);
    // Continue execution even if cache clearing fails
  }

  res.status(201).json({
    status: "success",
    data: {
      exam: newExam,
    },
  });
});

export default createExam;
