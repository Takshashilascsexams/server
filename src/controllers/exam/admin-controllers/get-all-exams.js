import mongoose from "mongoose";
import Exam from "../../../models/exam.models.js";
import ExamAttempt from "../../../models/examAttempt.models.js";
import ExamAnalytics from "../../../models/examAnalytics.models.js";
import { catchAsync } from "../../../utils/errorHandler.js";
import {
  examService,
  analyticsService,
} from "../../../services/redisService.js";

const getExamDashboard = catchAsync(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Sorting - ensure it's a valid field to prevent injection
  const validSortFields = [
    "createdAt",
    "title",
    "totalQuestions",
    "totalMarks",
    "category",
  ];
  const sortBy = validSortFields.includes(req.query.sortBy)
    ? req.query.sortBy
    : "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  // Filtering
  const filterOptions = {};

  // Handle active/inactive filter
  if (req.query.active === "true") filterOptions.isActive = true;
  if (req.query.active === "false") filterOptions.isActive = false;

  // Handle premium filter
  if (req.query.premium === "true") filterOptions.isPremium = true;

  // Handle featured filter
  if (req.query.featured === "true") filterOptions.isFeatured = true;

  // Handle bundle filter - check for non-empty array
  if (req.query.bundle === "true") {
    filterOptions.bundleTags = { $exists: true, $not: { $size: 0 } };
  }

  // Handle search query
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, "i");
    filterOptions.$or = [
      { title: searchRegex },
      { description: searchRegex },
      { category: searchRegex },
    ];
  }

  // Create cache key based on query parameters
  const cacheKey = `admin:dashboard:exams:${JSON.stringify({
    page,
    limit,
    sort: { by: sortBy, order: sortOrder },
    filterOptions,
  })}`;

  // Try to get from cache first
  try {
    const cachedData = await examService.get(examService.examCache, cacheKey);
    if (cachedData) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedData,
      });
    }
  } catch (error) {
    console.error("Cache error in getExamDashboard:", error);
    // Continue to database query on cache error
  }

  // Fetch exams with filters
  const exams = await Exam.find(filterOptions)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .select(
      "_id title description category duration totalQuestions totalMarks isActive isPremium isFeatured bundleTags createdAt"
    );

  // Get total count for pagination
  const total = await Exam.countDocuments(filterOptions);

  if (total === 0) {
    // Return empty results if no exams found
    return res.status(200).json({
      status: "success",
      data: {
        exams: [],
        pagination: {
          total: 0,
          page,
          pages: 0,
          limit,
        },
      },
    });
  }

  // Get analytics for each exam (in batch for efficiency)
  const examIds = exams.map((exam) => exam._id);

  // Try to get analytics from cache first
  let analyticsMap = {};
  try {
    // Using existing cache methods in parallel for better performance
    const analyticsPromises = examIds.map((id) => {
      try {
        return analyticsService.getAnalytics(id.toString());
      } catch (err) {
        console.error(`Error getting analytics for exam ${id}:`, err);
        return null;
      }
    });

    const analyticsResults = await Promise.all(analyticsPromises);

    // Build map of examId to analytics
    examIds.forEach((id, index) => {
      if (analyticsResults[index]) {
        analyticsMap[id.toString()] = analyticsResults[index];
      }
    });
  } catch (error) {
    console.error("Error fetching analytics from cache:", error);
  }

  // For any missing analytics, fetch from database
  const missingExamIds = examIds.filter((id) => !analyticsMap[id.toString()]);
  if (missingExamIds.length > 0) {
    try {
      const dbAnalytics = await ExamAnalytics.find({
        examId: { $in: missingExamIds },
      }).lean();

      // Add to map and cache
      dbAnalytics.forEach((analytics) => {
        analyticsMap[analytics.examId.toString()] = analytics;
        // Cache for future requests
        analyticsService.setAnalytics(analytics.examId.toString(), analytics);
      });
    } catch (error) {
      console.error("Error fetching analytics from database:", error);
    }
  }

  // Get attempt counts for each exam
  let attemptCountMap = {};
  try {
    // Convert examIds to ObjectIds safely
    const validExamObjectIds = examIds
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch (err) {
          console.error(`Invalid ObjectId: ${id}`);
          return null;
        }
      })
      .filter(Boolean);

    const attemptCounts = await ExamAttempt.aggregate([
      { $match: { examId: { $in: validExamObjectIds } } },
      {
        $group: {
          _id: "$examId",
          totalAttempted: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          passed: { $sum: { $cond: [{ $eq: ["$hasPassed", true] }, 1, 0] } },
          failed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "completed"] },
                    { $eq: ["$hasPassed", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    attemptCountMap = attemptCounts.reduce((map, item) => {
      map[item._id.toString()] = item;
      return map;
    }, {});
  } catch (error) {
    console.error("Error getting attempt counts:", error);
  }

  // Combine exam data with analytics
  const examData = exams.map((exam) => {
    const examId = exam._id.toString();
    const analytics = analyticsMap[examId] || {};
    const attempts = attemptCountMap[examId] || {
      totalAttempted: 0,
      completed: 0,
      passed: 0,
      failed: 0,
    };

    return {
      ...exam.toJSON(),
      analytics: {
        totalAttempted: attempts.totalAttempted || 0,
        completed: attempts.completed || 0,
        passed: attempts.passed || 0,
        failed: attempts.failed || 0,
        averageScore: analytics.averageScore || 0,
        highestScore: analytics.highestScore || 0,
      },
    };
  });

  // Prepare response
  const responseData = {
    exams: examData,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };

  // Cache the result for 5 minutes
  try {
    await examService.set(examService.examCache, cacheKey, responseData, 300);
  } catch (cacheError) {
    console.error("Failed to cache exam dashboard:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getExamDashboard;
