import Publication from "../../../models/publication.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { isCloudinaryUrl } from "../../../services/pdfService.js";
import cloudinary from "cloudinary";

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

  // Handle the file URL based on environment and storage provider
  let fileUrl = publication.fileUrl;
  const storageProvider =
    publication.storageProvider ||
    (isCloudinaryUrl(fileUrl) ? "cloudinary" : "local");

  if (storageProvider === "cloudinary") {
    // For Cloudinary URLs
    if (process.env.NODE_ENV === "production") {
      // In production, we might want a signed URL with expiration for security
      if (!fileUrl.includes("?")) {
        try {
          // If URL doesn't have query parameters (not already signed)
          const urlParts = fileUrl.split("/");
          const filename = urlParts[urlParts.length - 1];
          const publicId = `exam-results/${filename.replace(/\.pdf$/, "")}`;

          // Use short expiration for production
          const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
          fileUrl = cloudinary.utils.private_download_url(publicId, "pdf", {
            resource_type: "raw",
            expires_at: expiresAt,
          });
        } catch (error) {
          console.error("Error generating Cloudinary signed URL:", error);
          // Keep original URL if signing fails
        }
      }
    } else {
      // In development, use the direct URL for easier access
      console.log(`Using Cloudinary URL in development: ${fileUrl}`);
    }
  } else if (storageProvider === "s3") {
    // Legacy S3 URL handling for backward compatibility
    if (process.env.NODE_ENV !== "production") {
      // Make sure we're using the URL from public directory
      if (fileUrl.includes("/uploads/publications/")) {
        const fileName = fileUrl.split("/").pop();
        fileUrl = `/publications/${fileName}`;
      }
    } else {
      // For S3 URLs in production, warn about migration
      if (!fileUrl.includes("cloudinary") && fileUrl.includes("amazonaws")) {
        console.warn(
          `Legacy S3 URL detected: ${fileUrl}. Consider running the Cloudinary migration script.`
        );
        // No actual way to handle this since we've removed S3 dependencies
      }
    }
  } else {
    // Local files in development
    if (fileUrl.includes("/uploads/publications/")) {
      const fileName = fileUrl.split("/").pop();
      fileUrl = `/publications/${fileName}`;
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
    storageProvider: storageProvider,
  };

  res.status(200).json({
    status: "success",
    data: {
      publication: formattedPublication,
    },
  });
});

export default getPublicationById;
