import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

/**
 * Update an existing exam
 * Handles all the fields shown in the EditExamForm component
 */
const updateExam = catchAsync(async (req, res, next) => {
  const { id: examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Validate required fields based on the EditExamForm
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
    isFeatured,
    isPremium,
    price,
    discountPrice,
    accessPeriod,
    isPartOfBundle,
    bundleTag,
    isActive,
  } = req.body;

  // Transform form values to API expected format
  const examData = {
    title,
    description,
    duration: parseInt(duration),
    totalQuestions: parseInt(totalQuestions),
    totalMarks: parseInt(totalMarks),
    hasNegativeMarking: hasNegativeMarking === "Yes",
    negativeMarkingValue: parseFloat(negativeMarkingValue),
    passMarkPercentage: parseInt(passMarkPercentage),
    difficultyLevel,
    category,
    allowNavigation: allowNavigation === "Yes",
    isFeatured: isFeatured === "Yes",
    isPremium: isPremium === "Yes",
    price: price ? parseFloat(price) : 0,
    discountPrice: discountPrice ? parseFloat(discountPrice) : 0,
    accessPeriod: accessPeriod ? parseInt(accessPeriod) : 0,
    bundleTags: isPartOfBundle && bundleTag ? [bundleTag] : [],
    isActive: isActive !== undefined ? isActive : true,
  };

  // Find and update the exam
  const updatedExam = await Exam.findByIdAndUpdate(examId, examData, {
    new: true, // Return the updated document
    runValidators: true, // Run validators on update
  });

  // Check if exam exists
  if (!updatedExam) {
    return next(new AppError("No exam found with that ID", 404));
  }

  // Clear cache for this exam and related caches
  try {
    await Promise.all([
      examService.deleteExam(examId),
      examService.clearExamCache(),
      examService.clearLatestExamsCache(),
      examService.clearCategorizedExamsCache(),
    ]);
  } catch (cacheError) {
    console.error("Failed to clear exam cache:", cacheError);
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
