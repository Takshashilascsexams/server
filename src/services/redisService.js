import createRedisClient from "../utils/redisClient.js";

// Create Redis clients with different prefixes for different data types
const examCache = createRedisClient("exam:");
const userCache = createRedisClient("user:");
const questionCache = createRedisClient("question:");
const analyticsCache = createRedisClient("analytics:");
const paymentCache = createRedisClient("payment:");

// Default TTL (Time To Live) for cached items in seconds
const DEFAULT_TTL = 60 * 60;

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

  // Generic data caching methods for user-specific data
  getUserSpecificExamsCache: async (key) => get(examCache, key),
  setUserSpecificExamsCache: async (key, data, ttl = DEFAULT_TTL) =>
    set(examCache, key, data, ttl),
  clearUserSpecificExamsCache: async (key) => del(examCache, key),
  clearCategorizedExamsCache: async () => {
    // Clear both generic and user-specific categorized exam caches
    await clearPattern(examCache, "categorized:*");
  },

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

  // Bundle-specific methods
  getBundleCache: async (bundleId, userId) =>
    get(examCache, `bundle:${bundleId}:${userId}`),
  setBundleCache: async (bundleId, userId, bundleData, ttl = 15 * 60) =>
    set(examCache, `bundle:${bundleId}:${userId}`, bundleData, ttl),
  clearBundleCache: async (bundleId) =>
    clearPattern(examCache, `bundle:${bundleId}:*`),
  clearAllBundleCache: async () => clearPattern(examCache, `bundle:*`),
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

// Exam attempt specific cache methods
const attemptService = {
  // Get attempt from cache
  getAttempt: async (attemptId) => get(examCache, `attempt:${attemptId}`),

  // Set attempt in cache
  setAttempt: async (attemptId, attemptData, ttl = DEFAULT_TTL) =>
    set(examCache, `attempt:${attemptId}`, attemptData, ttl),

  // Delete attempt from cache
  deleteAttempt: async (attemptId) => del(examCache, `attempt:${attemptId}`),

  // Get user's attempts by examId
  getUserAttemptsByExam: async (userId, examId) =>
    get(examCache, `attempts:user:${userId}:exam:${examId}`),

  // Set user's attempts by examId
  setUserAttemptsByExam: async (userId, examId, attemptsData, ttl = 5 * 60) =>
    set(examCache, `attempts:user:${userId}:exam:${examId}`, attemptsData, ttl),

  // Get exam rankings
  getExamRankings: async (examId) => get(examCache, `rankings:${examId}`),

  // Set exam rankings
  setExamRankings: async (examId, rankingsData, ttl = 60 * 60) =>
    set(examCache, `rankings:${examId}`, rankingsData, ttl),

  // Clear all user attempts cache
  clearUserAttempts: async (userId) =>
    clearPattern(examCache, `attempts:user:${userId}:*`),

  // Clear exam rankings cache
  clearExamRankings: async (examId) => del(examCache, `rankings:${examId}`),

  // Get exam rules
  getExamRules: async (examId) => get(examCache, `rules:${examId}`),

  // Set exam rules
  setExamRules: async (examId, rulesData, ttl = 24 * 60 * 60) =>
    set(examCache, `rules:${examId}`, rulesData, ttl),
};

// Analytics specific cache methods
const analyticsService = {
  getAnalytics: async (examId) => get(analyticsCache, examId),
  setAnalytics: async (examId, analyticsData, ttl = DEFAULT_TTL) =>
    set(analyticsCache, examId, analyticsData, ttl),
  deleteAnalytics: async (examId) => del(analyticsCache, examId),
  clearAnalyticsCache: async () => clearPattern(analyticsCache, "*"),
};

// Payment and access specific cache methods
const paymentService = {
  // Get user's access to exams
  getUserExamAccess: async (userId) => get(paymentCache, `access:${userId}`),

  // Set user's access to exams
  setUserExamAccess: async (userId, accessMap, ttl = 5 * 60) =>
    set(paymentCache, `access:${userId}`, accessMap, ttl),

  // Clear a user's access cache when payment status changes
  clearUserExamAccess: async (userId) => del(paymentCache, `access:${userId}`),

  // Clear access cache for all users (e.g., after bulk changes)
  clearAllExamAccess: async () => clearPattern(paymentCache, "access:*"),
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
  paymentService,
  checkHealth,
};
