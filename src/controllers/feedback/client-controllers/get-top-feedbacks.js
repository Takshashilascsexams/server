import Feedback from "../../../models/feedback.models.js";
import { catchAsync } from "../../../utils/errorHandler.js";
import { feedbackService } from "../../../services/redisService.js";

const getTopFeedbacks = catchAsync(async (req, res, next) => {
  const { limit = 4, anonymous = "false" } = req.query;
  const parsedLimit = Math.min(parseInt(limit) || 4, 10);
  const isAnonymous = anonymous === "true" || anonymous === true;

  try {
    const cachedFeedbacks = await feedbackService.getTopFeedbacks(
      parsedLimit,
      isAnonymous
    );
    if (cachedFeedbacks) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: { feedbacks: cachedFeedbacks },
      });
    }
  } catch (error) {
    console.error("Cache error:", error);
  }

  const topFeedbacks = await Feedback.find({})
    .sort({ rating: -1, createdAt: -1 })
    .limit(parsedLimit)
    .populate({ path: "userId", select: "fullName avatar" })
    .lean();

  if (!topFeedbacks || topFeedbacks.length === 0) {
    return res.status(200).json({
      status: "success",
      data: { feedbacks: [] },
    });
  }

  const formattedFeedbacks = topFeedbacks.map((feedback) => ({
    id: feedback._id,
    rating: feedback.rating,
    comment: feedback.comment,
    createdAt: feedback.createdAt,
    user: isAnonymous
      ? { name: "Anonymous User", avatar: null }
      : {
          id: feedback.userId?._id || "Anonymous",
          name: feedback.userId?.fullName || "Anonymous User",
          avatar: feedback.userId?.avatar || null,
        },
  }));

  try {
    await feedbackService.setTopFeedbacks(
      parsedLimit,
      isAnonymous,
      formattedFeedbacks,
      60 * 15
    );
  } catch (cacheError) {
    console.error("Failed to cache:", cacheError);
  }

  res.status(200).json({
    status: "success",
    fromCache: false,
    data: { feedbacks: formattedFeedbacks },
  });
});

export default getTopFeedbacks;
