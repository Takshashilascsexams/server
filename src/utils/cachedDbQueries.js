import Exam from "../models/exam.models.js";
import User from "../models/user.models.js";
import { examService, userService } from "../services/redisService.js";

// Helper function to check if exam exists with Redis caching
export const checkExamExists = async (examId) => {
  try {
    // Try to get from Redis cache first
    const cachedExists = await examService.checkExamExists(examId);

    if (cachedExists !== null) {
      return cachedExists;
    }

    // If not in cache or expired, check database
    const exists = await Exam.exists({ _id: examId });

    // Update Redis cache
    await examService.setExamExists(examId, !!exists);

    return !!exists;
  } catch (error) {
    console.error("Error in checkExamExists:", error);
    // Fallback to direct database query if Redis fails
    return !!(await Exam.exists({ _id: examId }));
  }
};

// Helper function to get user ID with Redis caching
export const getUserId = async (clerkId) => {
  try {
    // Try to get from Redis cache first
    const cachedUserId = await userService.getUserByClerkId(clerkId);

    if (cachedUserId !== null) {
      return cachedUserId;
    }

    // If not in cache or expired, check database
    const user = await User.findOne({ clerkId }).select("_id").lean();
    const userId = user ? user._id : null;

    // Update Redis cache
    if (userId) {
      await userService.setUserByClerkId(clerkId, userId);
    }

    return userId;
  } catch (error) {
    console.error("Error in getUserId:", error);
    // Fallback to direct database query if Redis fails
    const user = await User.findOne({ clerkId }).select("_id").lean();
    return user ? user._id : null;
  }
};

// Add more cached database queries as needed
export const getSingleExamWithCache = async (examId) => {
  try {
    // Try to get from Redis cache first
    const cachedExam = await examService.getExam(examId);

    if (cachedExam !== null) {
      return cachedExam;
    }

    // If not in cache or expired, get from database with population
    const exam = await Exam.findById(examId).populate("analytics");

    // Update Redis cache
    if (exam) {
      await examService.setExam(examId, exam.toJSON());
    }

    return exam;
  } catch (error) {
    console.error("Error in getSingleExamWithCache:", error);
    // Fallback to direct database query if Redis fails
    return await Exam.findById(examId).populate("analytics");
  }
};
