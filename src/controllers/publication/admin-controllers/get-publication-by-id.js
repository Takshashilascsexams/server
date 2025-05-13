import Publication from "../../../models/publication.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { generateSignedUrl } from "../../../services/pdfService.js";

const getPublicationById = catchAsync(async (req, res, next) => {
  const { publicationId } = req.params;

  if (!publicationId) {
    return next(new AppError("Publication ID is required", 400));
  }

  // Find the publication
  const publication = await Publication.findById(publicationId).lean();

  if (!publication) {
    return next(new AppError("Publication not found", 404));
  }

  // Get exam details
  const exam = await Exam.findById(publication.examId)
    .select("title description")
    .lean();

  if (!exam) {
    return next(new AppError("Associated exam not found", 404));
  }

  // For development environments, use the direct file path
  // For production, generate a signed URL
  let fileUrl = publication.fileUrl;

  if (process.env.NODE_ENV !== "production") {
    // Make sure we're using the URL from public directory
    // If the URL still has the old format, update it
    if (fileUrl.includes("/uploads/publications/")) {
      const fileName = fileUrl.split("/").pop();
      fileUrl = `/publications/${fileName}`;
    }
  } else {
    // For production, generate signed URL if needed (keep your existing code)
    if (!fileUrl.includes("Signature=")) {
      try {
        const key = fileUrl.split("/").slice(-2).join("/");
        fileUrl = await generateSignedUrl(key);
      } catch (error) {
        console.error("Error generating signed URL:", error);
      }
    }
  }

  // Format response data
  const formattedPublication = {
    id: publication._id,
    examId: publication.examId,
    examTitle: exam.title,
    examDescription: exam.description,
    fileUrl: fileUrl,
    fileName: publication.fileName,
    studentCount: publication.studentCount,
    isPublished: publication.isPublished,
    publishedAt: publication.publishedAt,
    createdAt: publication.createdAt,
  };

  res.status(200).json({
    status: "success",
    data: {
      publication: formattedPublication,
    },
  });
});

export default getPublicationById;
