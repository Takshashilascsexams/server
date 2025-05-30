import mongoose from "mongoose";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { examService } from "../../../services/redisService.js";

/**
 * Helper function to format result data consistently
 * @param {Array} attempts - The attempt records to format
 * @param {Object} exam - The exam details
 * @returns {Array} - Formatted results array
 */
const formatResultsData = (attempts, exam) => {
  return attempts.map((attempt) => {
    // Calculate score as number first, then convert to string only at the end
    let scoreValue = null;
    if (attempt.status === "completed") {
      // Keep score as a number for frontend flexibility
      scoreValue = parseFloat(
        ((attempt.finalScore / exam.totalMarks) * 100).toFixed(1)
      );
    }

    return {
      id: attempt._id,
      userId: attempt.userId?._id || attempt.userDetails?._id || "Anonymous",
      studentName:
        attempt.userId?.fullName ||
        attempt.userDetails?.fullName ||
        "Anonymous User",
      startedAt: attempt.startTime,
      completedAt: attempt.endTime,
      status: attempt.status,
      score: scoreValue, // Pass as number, not string
      hasPassed: attempt.hasPassed,
      totalQuestions: exam.totalQuestions,
      questionsAttempted: attempt.answers.filter(
        (a) => a.selectedOption !== null
      ).length,
      correctAnswers: attempt.correctAnswers,
      wrongAnswers: attempt.wrongAnswers,
      unanswered: attempt.unattempted,
      timeSpent: attempt.endTime
        ? Math.floor(
            (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
          )
        : exam.duration * 60 - (attempt.timeRemaining || 0),
    };
  });
};

/**
 * Admin controller to get student results for a specific exam
 * - Returns details of all attempts with pagination, filtering, and sorting
 * - Includes student details for admin panel display
 */
const getExamResults = catchAsync(async (req, res, next) => {
  const { examId } = req.params;

  // Parse query parameters with defaults
  const {
    page = 1,
    limit = 10,
    sortBy = "startedAt",
    sortOrder = "desc",
    status = "all",
    search = "",
  } = req.query;

  // Calculate skip value for pagination - defined early for use in all query paths
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Debug logging for sorting parameters
  console.log(
    `Sorting parameters - sortBy: ${sortBy}, sortOrder: ${sortOrder}`
  );

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Create cache key based on query parameters
  const cacheKey = `admin:exam:results:${examId}:${page}:${limit}:${sortBy}:${sortOrder}:${status}:${search}`;

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
    console.error("Cache error in getExamResults:", error);
    // Continue to database query on cache error
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Build query based on filters
  const query = { examId: new mongoose.Types.ObjectId(examId) };

  // Add status filter if not "all"
  if (status !== "all") {
    query.status = status;
  }

  // Add search filter if present
  if (search.trim()) {
    // We need to search by student name or ID, which requires a join
    // Check if search is a potential phone number (contains only digits)
    const isNumeric = /^\d+$/.test(search);

    // Build search query based on search type
    const searchQuery = [];

    // Always add text-based searches
    searchQuery.push(
      { fullName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } }
    );

    // Add phone number search only if it's numeric
    if (isNumeric) {
      // For phone number, use equality instead of regex since it's a number field
      searchQuery.push({ phoneNumber: parseInt(search, 10) });
    }

    // Find users matching the search query
    const users = await User.find({ $or: searchQuery }).select("_id");

    const userIds = users.map((user) => user._id);

    if (userIds.length > 0) {
      query.userId = { $in: userIds };
    } else {
      // No matching users, return empty result
      return res.status(200).json({
        status: "success",
        data: {
          results: [],
          pagination: {
            total: 0,
            page: parseInt(page),
            pages: 0,
            limit: parseInt(limit),
          },
        },
      });
    }
  }

  // Build sort object
  const sort = {};

  // Handle special sorting cases
  if (sortBy === "studentName") {
    // We need to join with User model to sort by name
    // This is a special case for sorting by a field from a related document
    // Use aggregation instead of find for this specific sort case
    const aggregationPipeline = [
      { $match: query },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
      {
        $sort: {
          "userDetails.fullName": sortOrder === "asc" ? 1 : -1,
        },
      },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ];

    // Execute aggregation pipeline
    const attemptsFromAggregate = await ExamAttempt.aggregate(
      aggregationPipeline
    );

    // Manually populate the userId field with the data we already have
    const populatedAttempts = attemptsFromAggregate.map((attempt) => ({
      ...attempt,
      userId: attempt.userDetails, // Replace the userId (ObjectId) with the user document
    }));

    // Get total count for pagination - count has to be done separately
    const total = await ExamAttempt.countDocuments(query);

    // Format the results data
    const results = formatResultsData(populatedAttempts, exam);

    // Prepare response data
    const responseData = {
      results,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
      },
    };

    // Cache the result
    try {
      await examService.set(examService.examCache, cacheKey, responseData, 120);
    } catch (cacheError) {
      console.error("Failed to cache exam results:", cacheError);
    }

    // Send response
    return res.status(200).json({
      status: "success",
      fromCache: false,
      data: responseData,
    });
  } else if (sortBy === "score") {
    // Special case for score - we need to handle nullable fields
    // First handle completed attempts (with scores)
    sort.status = sortOrder === "asc" ? 1 : -1; // Completed first
    sort.finalScore = sortOrder === "asc" ? 1 : -1; // Then by score
  } else if (sortBy === "completedAt") {
    // Special case for completedAt - needs null handling
    // First sort by status to group completed together
    sort.status = sortOrder === "asc" ? 1 : -1;
    // Then sort by completedAt date for those that are completed
    sort.endTime = sortOrder === "asc" ? 1 : -1;
  } else {
    // For other sorting fields, use the standard approach
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
  }

  // Get attempts with pagination
  const attempts = await ExamAttempt.find(query)
    .sort(sort)
    .skip(skip)
    .limit(parseInt(limit))
    .populate({
      path: "userId",
      select: "fullName email phoneNumber avatar",
    })
    .lean();

  // Get total count for pagination
  const total = await ExamAttempt.countDocuments(query);

  // Format the results data
  const results = formatResultsData(attempts, exam);

  // Prepare response data
  const responseData = {
    results,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };

  // Cache the result for 2 minutes
  try {
    await examService.set(examService.examCache, cacheKey, responseData, 120);
  } catch (cacheError) {
    console.error("Failed to cache exam results:", cacheError);
  }

  // Send response
  res.status(200).json({
    status: "success",
    fromCache: false,
    data: responseData,
  });
});

export default getExamResults;
