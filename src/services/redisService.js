// src/services/redisService.js
import createRedisClient from "../utils/redisClient.js";

// Create Redis clients with different prefixes for different data types
const examCache = createRedisClient("exam:");
const userCache = createRedisClient("user:");
const questionCache = createRedisClient("question:");
const analyticsCache = createRedisClient("analytics:");

// Default TTL (Time To Live) for cached items in seconds
const DEFAULT_TTL = 60 * 60; // 1 hour

/**
 * Generic get method to retrieve data from cache
 * @param {Object} redisClient - Redis client instance
 * @param {String} key - Cache key
 * @returns {Promise<Object|null>} - Cached data or null if not found
 */
const get = async (redisClient, key) => {
  try {
    const cachedData = await redisClient.get(key);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (error) {
    console.error(`Redis GET error: ${error.message}`);
    return null; // Return null on error to fallback to database
  }
};

/**
 * Generic set method to store data in cache
 * @param {Object} redisClient - Redis client instance
 * @param {String} key - Cache key
 * @param {Object} data - Data to cache
 * @param {Number} ttl - Time to live in seconds
 * @returns {Promise<Boolean>} - Success status
 */
const set = async (redisClient, key, data, ttl = DEFAULT_TTL) => {
  try {
    await redisClient.set(key, JSON.stringify(data), "EX", ttl);
    return true;
  } catch (error) {
    console.error(`Redis SET error: ${error.message}`);
    return false;
  }
};

/**
 * Generic delete method to remove data from cache
 * @param {Object} redisClient - Redis client instance
 * @param {String} key - Cache key
 * @returns {Promise<Boolean>} - Success status
 */
const del = async (redisClient, key) => {
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.error(`Redis DEL error: ${error.message}`);
    return false;
  }
};

/**
 * Clear all keys with a specific pattern
 * @param {Object} redisClient - Redis client instance
 * @param {String} pattern - Pattern to match keys
 * @returns {Promise<Boolean>} - Success status
 */
const clearPattern = async (redisClient, pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    return true;
  } catch (error) {
    console.error(`Redis CLEAR error: ${error.message}`);
    return false;
  }
};

// Exam specific cache methods
const examService = {
  getExam: async (examId) => get(examCache, examId),
  setExam: async (examId, examData, ttl = DEFAULT_TTL) =>
    set(examCache, examId, examData, ttl),
  deleteExam: async (examId) => del(examCache, examId),
  clearExamCache: async () => {
    await clearPattern(examCache, "*");
    await clearPattern(examCache, "categorized:*");
    await clearPattern(examCache, "latest:*");
  },
  checkExamExists: async (examId) => {
    const exists = await get(examCache, `exists:${examId}`);
    return exists !== null ? exists : null;
  },
  setExamExists: async (examId, exists) =>
    set(examCache, `exists:${examId}`, exists, DEFAULT_TTL),

  // Client methods for caching lists of latest test series
  getLatestExams: async (category, limit) =>
    get(examCache, `latest:${category}:${limit}`),
  setLatestExams: async (category, limit, examsData, ttl = DEFAULT_TTL) =>
    set(examCache, `latest:${category}:${limit}`, examsData, ttl),
  clearLatestExamsCache: async () => clearPattern(examCache, "latest:*"),

  // Client Methods for categorized exams
  getCategorizedExams: async (page, limit) =>
    get(examCache, `categorized:${page}:${limit}`),
  setCategorizedExams: async (page, limit, examsData, ttl = DEFAULT_TTL) =>
    set(examCache, `categorized:${page}:${limit}`, examsData, ttl),
  clearCategorizedExamsCache: async () =>
    clearPattern(examCache, "categorized:*"),
};

// User specific cache methods
const userService = {
  getUser: async (userId) => get(userCache, userId),
  getUserByClerkId: async (clerkId) => get(userCache, `clerk:${clerkId}`),
  setUser: async (userId, userData, ttl = DEFAULT_TTL) =>
    set(userCache, userId, userData, ttl),
  setUserByClerkId: async (clerkId, userId, ttl = DEFAULT_TTL) =>
    set(userCache, `clerk:${clerkId}`, userId, ttl),
  deleteUser: async (userId) => {
    await del(userCache, userId);
    // Also clear by clerkId if we have it
    const userIdKey = `clerk:${userId}`;
    const clerkId = await get(userCache, userIdKey);
    if (clerkId) {
      await del(userCache, `clerk:${clerkId}`);
    }
  },
  clearUserCache: async () => clearPattern(userCache, "*"),
};

// Question specific cache methods
const questionService = {
  getQuestion: async (questionId) => get(questionCache, questionId),
  getQuestionsByExam: async (examId) => get(questionCache, `exam:${examId}`),
  setQuestion: async (questionId, questionData, ttl = DEFAULT_TTL) =>
    set(questionCache, questionId, questionData, ttl),
  setQuestionsByExam: async (examId, questionsData, ttl = DEFAULT_TTL) =>
    set(questionCache, `exam:${examId}`, questionsData, ttl),
  deleteQuestion: async (questionId) => del(questionCache, questionId),
  deleteQuestionsByExam: async (examId) => del(questionCache, `exam:${examId}`),
  clearQuestionCache: async () => clearPattern(questionCache, "*"),
};

// Analytics specific cache methods
const analyticsService = {
  getAnalytics: async (examId) => get(analyticsCache, examId),
  setAnalytics: async (examId, analyticsData, ttl = DEFAULT_TTL) =>
    set(analyticsCache, examId, analyticsData, ttl),
  deleteAnalytics: async (examId) => del(analyticsCache, examId),
  clearAnalyticsCache: async () => clearPattern(analyticsCache, "*"),
};

// Health check method
const checkHealth = async () => {
  try {
    await examCache.ping();
    return true;
  } catch (error) {
    console.error(`Redis health check failed: ${error.message}`);
    return false;
  }
};

export {
  examService,
  userService,
  questionService,
  analyticsService,
  checkHealth,
};
