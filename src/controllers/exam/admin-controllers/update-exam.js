import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

/**
 * Update an existing exam
 * Handles all the fields shown in the EditExamForm component with proper validation
 */
const updateExam = catchAsync(async (req, res, next) => {
  const { id: examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Check if exam exists first
  const existingExam = await Exam.findById(examId);
  if (!existingExam) {
    return next(new AppError("No exam found with that ID", 404));
  }

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
    maxAttempt,
    isFeatured,
    isPremium,
    price,
    discountPrice,
    accessPeriod,
    isPartOfBundle,
    bundleTag,
    isActive,
  } = req.body;

  // Validate required fields - use existing values as fallback
  const requiredFields = [
    { value: title, name: "title", fallback: existingExam.title },
    {
      value: description,
      name: "description",
      fallback: existingExam.description,
    },
    { value: duration, name: "duration", fallback: existingExam.duration },
    {
      value: totalQuestions,
      name: "totalQuestions",
      fallback: existingExam.totalQuestions,
    },
    {
      value: totalMarks,
      name: "totalMarks",
      fallback: existingExam.totalMarks,
    },
    {
      value: hasNegativeMarking,
      name: "hasNegativeMarking",
      fallback: existingExam.hasNegativeMarking,
    },
    {
      value: negativeMarkingValue,
      name: "negativeMarkingValue",
      fallback: existingExam.negativeMarkingValue,
    },
    {
      value: passMarkPercentage,
      name: "passMarkPercentage",
      fallback: existingExam.passMarkPercentage,
    },
    {
      value: difficultyLevel,
      name: "difficultyLevel",
      fallback: existingExam.difficultyLevel,
    },
    { value: category, name: "category", fallback: existingExam.category },
    {
      value: allowNavigation,
      name: "allowNavigation",
      fallback: existingExam.allowNavigation,
    },
    {
      value: allowMultipleAttempts,
      name: "allowMultipleAttempts",
      fallback: existingExam.allowMultipleAttempts,
    },
    {
      value: maxAttempt,
      name: "maxAttempt",
      fallback: existingExam.maxAttempt,
    },
    { value: isPremium, name: "isPremium", fallback: existingExam.isPremium },
    { value: price, name: "price", fallback: existingExam.price },
    {
      value: discountPrice,
      name: "discountPrice",
      fallback: existingExam.discountPrice,
    },
    {
      value: accessPeriod,
      name: "accessPeriod",
      fallback: existingExam.accessPeriod,
    },
    {
      value: isFeatured,
      name: "isFeatured",
      fallback: existingExam.isFeatured,
    },
  ];

  // Check if any required field is null or undefined (only if provided in request)
  const missingFields = requiredFields.filter(
    (field) =>
      field.value !== undefined &&
      (field.value === null || field.value === undefined)
  );

  if (missingFields.length > 0) {
    const fieldNames = missingFields.map((field) => field.name).join(", ");
    return next(
      new AppError(
        `Please provide valid values for the following fields: ${fieldNames}`,
        400
      )
    );
  }

  // Use provided values or fallback to existing values for validation
  const finalMaxAttempt =
    maxAttempt !== undefined ? maxAttempt : existingExam.maxAttempt;
  const finalAllowMultipleAttempts =
    allowMultipleAttempts !== undefined
      ? allowMultipleAttempts
      : existingExam.allowMultipleAttempts;
  const finalIsPremium =
    isPremium !== undefined ? isPremium : existingExam.isPremium;
  const finalPrice = price !== undefined ? price : existingExam.price;
  const finalDiscountPrice =
    discountPrice !== undefined ? discountPrice : existingExam.discountPrice;
  // Handle form data transformation - the form sends different structure
  // The form sends: isPartOfBundle (boolean) and bundleTag (string)
  // But the controller logic expects these to be processed differently
  const processedIsPartOfBundle =
    isPartOfBundle !== undefined
      ? isPartOfBundle
      : existingExam.bundleTags &&
        existingExam.bundleTags.length > 0 &&
        existingExam.bundleTags[0] !== "";
  const processedBundleTag =
    bundleTag !== undefined
      ? bundleTag
      : existingExam.bundleTags && existingExam.bundleTags.length > 0
      ? existingExam.bundleTags[0]
      : "";

  // Validate attempt-related fields
  const parsedMaxAttempt = parseInt(finalMaxAttempt);
  const isMultipleAttemptsAllowed =
    finalAllowMultipleAttempts === "Yes" || finalAllowMultipleAttempts === true;

  if (isNaN(parsedMaxAttempt) || parsedMaxAttempt < 1 || parsedMaxAttempt > 2) {
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
  const isPremiumFinal = finalIsPremium === "Yes" || finalIsPremium === true;
  if (isPremiumFinal && (!finalPrice || parseFloat(finalPrice) <= 0)) {
    return next(
      new AppError("Premium exams must have a price greater than 0", 400)
    );
  }

  // Validate discount price is less than regular price
  if (
    finalDiscountPrice &&
    parseFloat(finalDiscountPrice) >= parseFloat(finalPrice)
  ) {
    return next(
      new AppError("Discount price must be less than regular price", 400)
    );
  }

  // Validate bundle requirements
  if (processedIsPartOfBundle && !processedBundleTag) {
    return next(new AppError("A bundle tag is required for bundle exams", 400));
  }

  // Validate bundle tag is from allowed list (if you have a predefined list)
  // You can add this validation if you have a bundleTagName array in your backend
  // const validBundleTags = ["NEET", "JEE", "UPSC"]; // Example
  // if (processedIsPartOfBundle && processedBundleTag && !validBundleTags.includes(processedBundleTag)) {
  //   return next(new AppError("Invalid bundle tag selected", 400));
  // }

  // Transform form values to API expected format
  const examData = {
    title: title !== undefined ? title : existingExam.title,
    description:
      description !== undefined ? description : existingExam.description,
    duration:
      duration !== undefined ? parseInt(duration) : existingExam.duration,
    totalQuestions:
      totalQuestions !== undefined
        ? parseInt(totalQuestions)
        : existingExam.totalQuestions,
    totalMarks:
      totalMarks !== undefined ? parseInt(totalMarks) : existingExam.totalMarks,
    hasNegativeMarking:
      hasNegativeMarking !== undefined
        ? hasNegativeMarking === "Yes" || hasNegativeMarking === true
        : existingExam.hasNegativeMarking,
    negativeMarkingValue:
      negativeMarkingValue !== undefined
        ? parseInt(negativeMarkingValue)
        : existingExam.negativeMarkingValue,
    passMarkPercentage:
      passMarkPercentage !== undefined
        ? parseInt(passMarkPercentage)
        : existingExam.passMarkPercentage,
    difficultyLevel:
      difficultyLevel !== undefined
        ? difficultyLevel
        : existingExam.difficultyLevel,
    category: category !== undefined ? category : existingExam.category,
    allowNavigation:
      allowNavigation !== undefined
        ? allowNavigation === "Yes" || allowNavigation === true
        : existingExam.allowNavigation,
    allowMultipleAttempts:
      allowMultipleAttempts !== undefined
        ? isMultipleAttemptsAllowed
        : existingExam.allowMultipleAttempts,
    maxAttempt:
      maxAttempt !== undefined ? parsedMaxAttempt : existingExam.maxAttempt,
    isFeatured:
      isFeatured !== undefined
        ? isFeatured === "Yes" || isFeatured === true
        : existingExam.isFeatured,
    isPremium:
      isPremium !== undefined ? isPremiumFinal : existingExam.isPremium,
    price: price !== undefined ? parseFloat(price) : existingExam.price,
    discountPrice:
      discountPrice !== undefined
        ? discountPrice
          ? parseFloat(discountPrice)
          : 0
        : existingExam.discountPrice,
    accessPeriod:
      accessPeriod !== undefined
        ? accessPeriod
          ? parseInt(accessPeriod)
          : 0
        : existingExam.accessPeriod,
    bundleTags:
      processedIsPartOfBundle && processedBundleTag && processedBundleTag.trim()
        ? [processedBundleTag.trim()]
        : [],
    isActive: isActive !== undefined ? isActive : existingExam.isActive,
  };

  // Update the exam
  const updatedExam = await Exam.findByIdAndUpdate(examId, examData, {
    new: true, // Return the updated document
    runValidators: true, // Run validators on update
  });

  // Clear cache for this exam and related caches - COMPREHENSIVE CLEARING
  try {
    await Promise.allSettled([
      // 1. Clear getCategorizedExams cache - examService.getUserSpecificExamsCache(cacheKey)
      // Pattern: categorized:shardId:userId (where cacheKey = `categorized:${userId}`)
      examService.clearCategorizedExamsCache(), // Clears categorized:*:* across all 16 shards

      // 2. Clear getLatestPublishedExams cache - examService.getCache(cacheKey)
      // Pattern: latest:published:${clerkId}:${LIMIT}
      examService.clearPattern(examService.examCache, "latest:published:*"),

      // 3. Clear getExamDashboard cache - examService.get(examService.examCache, cacheKey)
      // Pattern: admin:dashboard:exams:${JSON.stringify({page, limit, sort, filterOptions})}
      examService.clearPattern(
        examService.examCache,
        "admin:dashboard:exams:*"
      ),

      // 4. Clear getBundleDetails cache - examService.getBundleCache(bundleId, userIdString)
      // Pattern: bundle:shardId:bundleId:userId across 8 shards
      examService.clearAllBundleCache(),

      // 5. Clear getExamById cache - examService.get(examService.examCache, cacheKey)
      // Pattern: admin:exam:${examId}
      examService.clearPattern(examService.examCache, "admin:exam:*"),

      // 6. Clear getExamDetails cache - examService.get(examService.examCache, cacheKey)
      // Pattern: admin:exam:details:${examId}
      examService.clearPattern(examService.examCache, "admin:exam:details:*"),

      // 7. Clear specific exam cache for the updated exam
      examService.deleteExam(examId),

      // 8. Clear any additional general cache patterns that might be affected
      examService.clearPattern(examService.examCache, "latest:*"), // For any other latest patterns
      examService.clearPattern(examService.examCache, "exam:*"), // Individual exam cache
    ]);
  } catch (cacheError) {
    console.error("Failed to clear comprehensive exam cache:", cacheError);
    // Continue execution even if cache clearing fails
  }

  res.status(200).json({
    status: "success",
    data: {
      exam: updatedExam,
    },
  });
});

export default updateExam;
