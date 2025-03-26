import Exam from "../models/exam.models.js";
import User from "../models/user.models.js";

// Cache for frequently accessed data
const cache = {
  exams: new Map(),
  users: new Map(),
  expiryTime: 10 * 60 * 1000, // 10 minutes
};

// Helper function to check if exam exists with caching
export const checkExamExists = async (examId) => {
  // Check cache first
  if (cache.exams.has(examId)) {
    const cachedItem = cache.exams.get(examId);
    if (Date.now() - cachedItem.timestamp < cache.expiryTime) {
      return cachedItem.exists;
    }
  }

  // If not in cache or expired, check database
  const exists = await Exam.exists({ _id: examId });

  // Update cache
  cache.exams.set(examId, {
    exists,
    timestamp: Date.now(),
  });

  return exists;
};

// Helper function to get user with caching
export const getUserId = async (clerkId) => {
  // Check cache first
  if (cache.users.has(clerkId)) {
    const cachedItem = cache.users.get(clerkId);
    if (Date.now() - cachedItem.timestamp < cache.expiryTime) {
      return cachedItem.userId;
    }
  }

  // If not in cache or expired, check database
  const user = await User.findOne({ clerkId }).select("_id").lean();

  // Update cache
  cache.users.set(clerkId, {
    userId: user ? user._id : null,
    timestamp: Date.now(),
  });

  return user ? user._id : null;
};
