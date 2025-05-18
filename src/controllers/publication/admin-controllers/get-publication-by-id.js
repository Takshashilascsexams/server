import Publication from "../../../models/publication.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { isFirebaseUrl } from "../../../services/pdfService.js";

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

  // Handle the file URL based on storage provider
  let fileUrl = publication.fileUrl;
  const storageProvider = publication.storageProvider || "local";

  console.log(`Publication storage provider: ${storageProvider}`);
  console.log(`Original fileUrl: ${fileUrl}`);

  if (storageProvider === "firebase") {
    // For Firebase URLs, we can use them directly
    // Firebase Storage URLs already include authentication tokens when needed
    console.log("Using Firebase Storage URL directly");

    // Check if URL is actually from Firebase (in case of data inconsistency)
    if (!isFirebaseUrl(fileUrl)) {
      console.warn(
        "Storage provider is Firebase but URL doesn't match Firebase format"
      );
    }
  } else if (storageProvider === "cloudinary") {
    // For legacy Cloudinary URLs, keep for backward compatibility
    console.log("Found legacy Cloudinary URL - consider migrating to Firebase");
  } else if (storageProvider === "s3") {
    // Legacy S3 URL handling for backward compatibility
    console.warn("Found legacy S3 URL - consider migrating to Firebase");
  } else if (storageProvider === "local") {
    // For local files, ensure the path is correct
    if (fileUrl.includes("/uploads/publications/")) {
      const fileName = fileUrl.split("/").pop();
      fileUrl = `/publications/${fileName}`;
      console.log(`Using local storage URL: ${fileUrl}`);
    }
  }

  // Format response data
  const formattedPublication = {
    id: publication._id,
    examId: publication.examId,
    examTitle: exam.title,
    examDescription: exam.description,
    fileUrl: fileUrl, // Use the processed URL
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
