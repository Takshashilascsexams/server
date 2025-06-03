import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

/**
 * Update an existing exam
 * Synced with createExam controller for consistent validation and data transformation
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
    isPremium,
    price,
    discountPrice,
    accessPeriod,
    isFeatured,
    isPartOfBundle,
    bundleTag,
    isActive, // Update-specific field
  } = req.body;

  // Use provided values or fallback to existing values
  const finalTitle = title !== undefined ? title : existingExam.title;
  const finalDescription =
    description !== undefined ? description : existingExam.description;
  const finalDuration =
    duration !== undefined ? duration : existingExam.duration;
  const finalTotalQuestions =
    totalQuestions !== undefined ? totalQuestions : existingExam.totalQuestions;
  const finalTotalMarks =
    totalMarks !== undefined ? totalMarks : existingExam.totalMarks;
  const finalHasNegativeMarking =
    hasNegativeMarking !== undefined
      ? hasNegativeMarking
      : existingExam.hasNegativeMarking;
  const finalNegativeMarkingValue =
    negativeMarkingValue !== undefined
      ? negativeMarkingValue
      : existingExam.negativeMarkingValue;
  const finalPassMarkPercentage =
    passMarkPercentage !== undefined
      ? passMarkPercentage
      : existingExam.passMarkPercentage;
  const finalDifficultyLevel =
    difficultyLevel !== undefined
      ? difficultyLevel
      : existingExam.difficultyLevel;
  const finalCategory =
    category !== undefined ? category : existingExam.category;
  const finalAllowNavigation =
    allowNavigation !== undefined
      ? allowNavigation
      : existingExam.allowNavigation;
  const finalAllowMultipleAttempts =
    allowMultipleAttempts !== undefined
      ? allowMultipleAttempts
      : existingExam.allowMultipleAttempts;
  const finalMaxAttempt =
    maxAttempt !== undefined ? maxAttempt : existingExam.maxAttempt;
  const finalIsPremium =
    isPremium !== undefined ? isPremium : existingExam.isPremium;
  const finalPrice = price !== undefined ? price : existingExam.price;
  const finalDiscountPrice =
    discountPrice !== undefined ? discountPrice : existingExam.discountPrice;
  const finalAccessPeriod =
    accessPeriod !== undefined ? accessPeriod : existingExam.accessPeriod;
  const finalIsFeatured =
    isFeatured !== undefined ? isFeatured : existingExam.isFeatured;
  const finalIsPartOfBundle =
    isPartOfBundle !== undefined
      ? isPartOfBundle
      : existingExam.bundleTags &&
        existingExam.bundleTags.length > 0 &&
        existingExam.bundleTags[0] !== "";
  const finalBundleTag =
    bundleTag !== undefined
      ? bundleTag
      : existingExam.bundleTags && existingExam.bundleTags.length > 0
      ? existingExam.bundleTags[0]
      : "";
  const finalIsActive =
    isActive !== undefined ? isActive : existingExam.isActive;

  // Validate required fields are not null/undefined if provided
  const fieldsToValidate = [
    { value: finalTitle, name: "title" },
    { value: finalDescription, name: "description" },
    { value: finalDuration, name: "duration" },
    { value: finalTotalQuestions, name: "totalQuestions" },
    { value: finalTotalMarks, name: "totalMarks" },
    { value: finalHasNegativeMarking, name: "hasNegativeMarking" },
    { value: finalNegativeMarkingValue, name: "negativeMarkingValue" },
    { value: finalPassMarkPercentage, name: "passMarkPercentage" },
    { value: finalDifficultyLevel, name: "difficultyLevel" },
    { value: finalCategory, name: "category" },
    { value: finalAllowNavigation, name: "allowNavigation" },
    { value: finalAllowMultipleAttempts, name: "allowMultipleAttempts" },
    { value: finalMaxAttempt, name: "maxAttempt" },
    { value: finalIsPremium, name: "isPremium" },
    { value: finalPrice, name: "price" },
    { value: finalDiscountPrice, name: "discountPrice" },
    { value: finalAccessPeriod, name: "accessPeriod" },
    { value: finalIsFeatured, name: "isFeatured" },
  ];

  const missingFields = fieldsToValidate.filter(
    (field) => field.value === null || field.value === undefined
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

  // Validate attempt-related fields (same logic as createExam)
  const parsedMaxAttempt = parseInt(finalMaxAttempt);
  const isMultipleAttemptsAllowed =
    finalAllowMultipleAttempts === "Yes" || finalAllowMultipleAttempts === true;

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

  // Validate premium exam has correct price (same logic as createExam)
  if (finalIsPremium === true && (!finalPrice || parseFloat(finalPrice) <= 0)) {
    return next(
      new AppError("Premium exams must have a price greater than 0", 400)
    );
  }

  // Validate discount price is less than regular price (same logic as createExam)
  if (
    finalDiscountPrice &&
    parseFloat(finalDiscountPrice) >= parseFloat(finalPrice)
  ) {
    return next(
      new AppError("Discount price must be less than regular price", 400)
    );
  }

  // Validate bundle requirements (simplified to match createExam)
  if (finalIsPartOfBundle && !finalBundleTag) {
    return next(new AppError("A bundle tag is required for bundle exams", 400));
  }

  // Transform form values to API expected format (same as createExam)
  const examData = {
    title: finalTitle,
    description: finalDescription,
    duration: parseInt(finalDuration),
    totalQuestions: parseInt(finalTotalQuestions),
    totalMarks: parseInt(finalTotalMarks),
    hasNegativeMarking: finalHasNegativeMarking === "Yes" ? true : false,
    negativeMarkingValue: parseFloat(finalNegativeMarkingValue),
    passMarkPercentage: parseInt(finalPassMarkPercentage),
    difficultyLevel: finalDifficultyLevel,
    category: finalCategory,
    allowNavigation: finalAllowNavigation === "Yes" ? true : false,
    allowMultipleAttempts: isMultipleAttemptsAllowed,
    maxAttempt: parsedMaxAttempt,
    isPremium: finalIsPremium === "Yes" ? true : false,
    price: finalPrice ? parseFloat(finalPrice) : 0,
    discountPrice: finalDiscountPrice ? parseFloat(finalDiscountPrice) : 0,
    accessPeriod: finalAccessPeriod,
    isFeatured: finalIsFeatured === "Yes" ? true : false,
    bundleTags: finalBundleTag ? [finalBundleTag] : [], // Simplified to match createExam
    isActive: finalIsActive, // Update-specific field
  };

  // Update the exam
  const updatedExam = await Exam.findByIdAndUpdate(examId, examData, {
    new: true, // Return the updated document
    runValidators: true, // Run validators on update
  });

  // Comprehensive cache clearing for all affected controllers (same as createExam)
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

      // 4. Clear getCategorizedExams cache - user-specific categorized exams
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

      // 9. Clear user-specific exam access cache (since updated exam affects access)
      examService.clearPattern(examService.examCache, "access:*"),

      // 10. Clear any remaining cache patterns that might be used
      examService.clearPattern(examService.examCache, "latest:published:*"), // getLatestPublishedExams specific pattern

      // 11. Clear specific exam cache for the updated exam
      examService.deleteExam(examId),
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
