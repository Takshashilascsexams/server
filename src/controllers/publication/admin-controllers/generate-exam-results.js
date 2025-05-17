import Exam from "../../../models/exam.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Publication from "../../../models/publication.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import { publicationService } from "../../../services/redisService.js";
import { generateAndUploadPDF } from "../../../services/pdfService.js";

const generateExamResults = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Get user ID from token
  const userId = await getUserId(req.user.sub);
  if (!userId) {
    return next(new AppError("User not found", 404));
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Find all completed attempts for this exam, sorted by rank
  const attempts = await ExamAttempt.find({
    examId,
    status: "completed",
  })
    .sort({ rank: 1 })
    .populate({
      path: "userId",
      select: "fullName email",
    })
    .lean();

  if (attempts.length === 0) {
    return next(new AppError("No completed attempts found for this exam", 404));
  }

  // Calculate statistics
  const totalAttempts = attempts.length;
  const passedAttempts = attempts.filter((a) => a.hasPassed).length;
  const passRate = ((passedAttempts / totalAttempts) * 100).toFixed(2);
  const scores = attempts.map((a) => a.finalScore);
  const averageScore = (
    scores.reduce((a, b) => a + b, 0) / totalAttempts
  ).toFixed(2);
  const highestScore = Math.max(...scores);

  // Format data for PDF
  const formattedRankings = attempts.map((attempt) => {
    // Calculate time taken in a readable format
    const timeTaken = attempt.endTime
      ? Math.floor(
          (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
        )
      : exam.duration * 60;

    const hours = Math.floor(timeTaken / 3600);
    const minutes = Math.floor((timeTaken % 3600) / 60);
    const seconds = timeTaken % 60;

    const formattedTime = `${
      hours > 0 ? hours + "h " : ""
    }${minutes}m ${seconds}s`;

    return {
      rank: attempt.rank || "N/A",
      user: {
        id: attempt.userId?._id || "Anonymous",
        name: attempt.userId?.fullName || "Anonymous User",
        email: attempt.userId?.email || "N/A",
      },
      score: attempt.finalScore,
      percentage: (attempt.finalScore / exam.totalMarks) * 100,
      timeTaken: formattedTime,
      hasPassed: attempt.hasPassed,
    };
  });

  // Generate and upload PDF in one step
  try {
    const stats = {
      totalAttempts,
      passRate,
      averageScore,
      highestScore,
    };

    // Use the new combined function
    const { fileUrl, fileName } = await generateAndUploadPDF(
      exam,
      formattedRankings,
      stats
    );

    // Create publication record
    const publication = await Publication.create({
      examId,
      fileUrl,
      fileName,
      studentCount: attempts.length,
      isPublished: false,
      createdBy: userId,
      storageProvider: "cloudinary", // Add storage provider info
    });

    // Clear publication cache
    await publicationService.clearExamPublications(examId);

    res.status(201).json({
      status: "success",
      message: "Results generated successfully",
      data: {
        publication,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    return next(new AppError("Failed to generate results PDF", 500));
  }
});

export default generateExamResults;
