import Question from "../../../models/questions.models.js";
import { catchAsync } from "../../../utils/errorHandler.js";
import { questionService } from "../../../services/redisService.js";

const getAllQuestions = catchAsync(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Sorting - ensure it's a valid field to prevent injection
  const validSortFields = [
    "createdAt",
    "questionText",
    "type",
    "difficultyLevel", // Corrected from "difficulty" to match db field name
    "category",
    "marks",
  ];
  const sortBy = validSortFields.includes(req.query.sortBy)
    ? req.query.sortBy
    : "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  // Filtering
  const filterOptions = {};

  // Handle type filter
  if (req.query.type) filterOptions.type = req.query.type;

  // Handle difficulty filter
  if (req.query.difficulty)
    filterOptions.difficultyLevel = req.query.difficulty;

  // Handle category filter
  if (req.query.category) filterOptions.category = req.query.category;

  // Handle search query
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, "i");
    filterOptions.$or = [
      { questionText: searchRegex },
      { category: searchRegex },
      { "options.optionText": searchRegex },
    ];
  }

  // Create cache key based on query parameters
  const cacheKey = `admin:dashboard:questions:${JSON.stringify({
    page,
    limit,
    sort: { by: sortBy, order: sortOrder },
    filterOptions,
  })}`;

  // Try to get from cache first using question service
  try {
    const params = {
      page,
      limit,
      sort: { by: sortBy, order: sortOrder },
      filters: filterOptions,
    };
    const cachedData = await questionService.getQuestionsWithPagination(params);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getAllQuestions:", error);
    // Continue to database query on cache error
  }

  // Fetch questions with filters
  const questions = await Question.find(filterOptions)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .select(
      "_id questionText type difficultyLevel category marks negativeMarks options statements createdAt"
    );

  // Get total count for pagination
  const total = await Question.countDocuments(filterOptions);

  if (total === 0) {
    // Return empty results if no questions found
    return res.status(200).json({
      status: "success",
      data: {
        questions: [],
        pagination: {
          total: 0,
          page,
          pages: 0,
          limit,
        },
      },
    });
  }

  // Prepare response
  const responseData = {
    questions,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };

  // Cache the result for 5 minutes using enhanced method
  try {
    const params = {
      page,
      limit,
      sort: { by: sortBy, order: sortOrder },
      filters: filterOptions,
    };
    await questionService.setQuestionsWithPagination(params, responseData, 300);

    // Also cache all categories if we have a reasonable number of questions
    if (page === 1 && !req.query.search) {
      const categories = await Question.distinct("category");
      if (categories.length > 0) {
        await questionService.setCachedCategories(categories);
      }
    }
  } catch (cacheError) {
    console.error("Failed to cache questions dashboard:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getAllQuestions;
