import Publication from "../../../models/publication.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync } from "../../../utils/errorHandler.js";
import { publicationService } from "../../../services/redisService.js";

const getActivePublications = catchAsync(async (req, res, next) => {
  // Try to get from cache first
  try {
    const cachedPublications = await publicationService.getActivePublications();
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
    console.error("Cache error in getActivePublications:", error);
  }

  // Find all published publications
  const publications = await Publication.find({
    isPublished: true,
  })
    .sort({ publishedAt: -1 })
    .lean();

  // Gather all exam IDs
  const examIds = [...new Set(publications.map((pub) => pub.examId))];

  // Fetch exam details in bulk for better performance
  const exams = await Exam.find({
    _id: { $in: examIds },
  })
    .select("title description category")
    .lean();

  // Create map for quick lookup
  const examMap = exams.reduce((map, exam) => {
    map[exam._id.toString()] = exam;
    return map;
  }, {});

  // Format publication data with exam details
  const formattedPublications = publications.map((pub) => {
    const examId = pub.examId.toString();
    const exam = examMap[examId];

    return {
      id: pub._id,
      title: exam?.title || "Unknown Exam",
      description: exam?.description || "",
      category: exam?.category || "OTHER",
      fileUrl: pub.fileUrl,
      fileName: pub.fileName,
      studentCount: pub.studentCount,
      publishedAt: pub.publishedAt,
    };
  });

  // Cache the publications
  try {
    await publicationService.setActivePublications(formattedPublications);
  } catch (error) {
    console.error("Error caching active publications:", error);
  }

  res.status(200).json({
    status: "success",
    fromCache: false,
    data: {
      publications: formattedPublications,
    },
  });
});

export default getActivePublications;
