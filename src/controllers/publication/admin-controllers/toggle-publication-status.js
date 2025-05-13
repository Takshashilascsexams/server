import Publication from "../../../models/publication.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { publicationService } from "../../../services/redisService.js";

const togglePublicationStatus = catchAsync(async (req, res, next) => {
  const { publicationId } = req.params;
  const { isPublished } = req.body;

  if (!publicationId) {
    return next(new AppError("Publication ID is required", 400));
  }

  if (isPublished === undefined) {
    return next(new AppError("isPublished status is required", 400));
  }

  // Find the publication
  const publication = await Publication.findById(publicationId);
  if (!publication) {
    return next(new AppError("Publication not found", 404));
  }

  // Update publication status
  publication.isPublished = isPublished;
  publication.publishedAt = isPublished ? new Date() : null;
  await publication.save();

  // Clear caches
  await Promise.all([
    publicationService.clearExamPublications(publication.examId),
    publicationService.clearAllPublicationsCache(),
  ]);

  res.status(200).json({
    status: "success",
    message: isPublished
      ? "Publication published successfully"
      : "Publication unpublished successfully",
    data: {
      publication,
    },
  });
});

export default togglePublicationStatus;
