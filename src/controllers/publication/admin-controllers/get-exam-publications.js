import Publication from "../../../models/publication.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { publicationService } from "../../../services/redisService.js";

const getExamPublications = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Try to get from cache first
  try {
    const cachedPublications = await publicationService.getExamPublications(
      examId
    );
    if (cachedPublications) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: {
          publications: cachedPublications,
        },
      });
    }
  } catch (error) {
    console.error("Cache error in getExamPublications:", error);
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Find all publications for this exam
  const publications = await Publication.find({ examId })
    .sort({ createdAt: -1 })
    .lean();

  // Format response data with needed fields
  const formattedPublications = publications.map((pub) => ({
    id: pub._id,
    examId: pub.examId,
    examTitle: exam.title,
    fileUrl: pub.fileUrl,
    fileName: pub.fileName,
    studentCount: pub.studentCount,
    isPublished: pub.isPublished,
    publishedAt: pub.publishedAt,
    createdAt: pub.createdAt,
  }));

  // Cache the publications
  try {
    await publicationService.setExamPublications(examId, formattedPublications);
  } catch (error) {
    console.error("Error caching exam publications:", error);
  }

  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      publications: formattedPublications,
    },
  });
});

export default getExamPublications;
