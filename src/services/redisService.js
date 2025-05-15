import createRedisClient from "../utils/redisClient.js";

// Create Redis clients with different prefixes for different data types
const examCache = createRedisClient("exam:");
const userCache = createRedisClient("user:");
const questionCache = createRedisClient("question:");
const analyticsCache = createRedisClient("analytics:");
const paymentCache = createRedisClient("payment:");
const batchQueue = createRedisClient("batch:");
const publicationCache = createRedisClient("publication:");

// Default TTL (Time To Live) for cached items in seconds
const DEFAULT_TTL = 60 * 60;

// Batch processing configuration
const BATCH_SIZE = 50;
const BATCH_INTERVAL = 5000; // 5 seconds

/**
 * Generic get method to retrieve data from cache with improved error handling
 */
const get = async (redisClient, key) => {
  try {
    const cachedData = await redisClient.get(key);
    return cachedData ? JSON.parse(cachedData) : null;
  } catch (error) {
    console.error(`Redis GET error (${key}):`, error.message);
    return null; // Return null on error to fallback to database
  }
};

/**
 * Generic set method with retry logic
 */
const set = async (redisClient, key, data, ttl = DEFAULT_TTL, retries = 2) => {
  try {
    await redisClient.set(key, JSON.stringify(data), "EX", ttl);
    return true;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Redis SET retry for ${key}, attempts left: ${retries}`);
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 200 * (3 - retries)));
      return set(redisClient, key, data, ttl, retries - 1);
    }
    console.error(`Redis SET error (${key}):`, error.message);
    return false;
  }
};

/**
 * Generic delete method with retry
 */
const del = async (redisClient, key, retries = 1) => {
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Redis DEL retry for ${key}, attempts left: ${retries}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return del(redisClient, key, retries - 1);
    }
    console.error(`Redis DEL error (${key}):`, error.message);
    return false;
  }
};

/**
 * Clear all keys with a specific pattern
 */
const clearPattern = async (redisClient, pattern, batchSize = 100) => {
  try {
    // Use SCAN instead of KEYS for production environments
    let cursor = "0";
    let keysDeleted = 0;

    do {
      // Scan keys in batches to prevent blocking Redis
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        batchSize
      );

      cursor = nextCursor;

      if (keys.length > 0) {
        // Delete keys in batches
        await redisClient.del(...keys);
        keysDeleted += keys.length;
      }
    } while (cursor !== "0");

    console.log(`Cleared ${keysDeleted} keys matching pattern: ${pattern}`);
    return true;
  } catch (error) {
    console.error(`Redis CLEAR error (${pattern}):`, error.message);
    return false;
  }
};

/**
 * Add item to batch processing queue
 */
const addToBatchQueue = async (type, data) => {
  try {
    // Create a unique ID for this batch item
    const itemId = `${type}:${Date.now()}:${Math.random()
      .toString(36)
      .substring(2, 10)}`;

    // Add to queue for batch processing
    await batchQueue.lpush(
      `queue:${type}`,
      JSON.stringify({
        id: itemId,
        data,
        timestamp: Date.now(),
      })
    );

    // Trim queue if it gets too long (prevent memory issues)
    await batchQueue.ltrim(`queue:${type}`, 0, 10000);

    return true;
  } catch (error) {
    console.error(`Failed to add item to batch queue (${type}):`, error);
    return false;
  }
};

/**
 * Process batch queue (to be called by a worker process/cron job)
 */
const processBatchQueue = async (type, processor) => {
  try {
    // Get up to BATCH_SIZE items from the queue
    const items = await batchQueue.lrange(`queue:${type}`, 0, BATCH_SIZE - 1);

    if (items.length === 0) {
      return 0;
    }

    // Parse items with individual error handling
    const parsedItems = items
      .map((item) => {
        try {
          return JSON.parse(item);
        } catch (e) {
          console.error(`Failed to parse batch item: ${e.message}`);
          return null;
        }
      })
      .filter(Boolean);

    // Process items in batch
    try {
      await processor(parsedItems);
    } catch (error) {
      console.error(`Error in batch processor for ${type}:`, error);
      // Continue to remove items from queue
    }

    // Remove processed items from queue
    await batchQueue.ltrim(`queue:${type}`, items.length, -1);

    return items.length;
  } catch (error) {
    console.error(`Error processing batch queue (${type}):`, error);
    return 0;
  }
};

// Enhanced exam service with batching and improved caching
const examService = {
  // Expose generic functions
  get,
  set,
  del,
  clearPattern,
  examCache,

  // Basic cache operations
  getExam: async (examId) => get(examCache, `exam:${examId}`),
  setExam: async (examId, examData, ttl = DEFAULT_TTL) =>
    set(examCache, `exam:${examId}`, examData, ttl),
  deleteExam: async (examId) => del(examCache, `exam:${examId}`),

  // New helper methods for exam access
  getExamAccess: async (userId, examId) => {
    const key = `access:${userId}:${examId}`;
    return get(examCache, key);
  },

  setExamAccess: async (userId, examId, hasAccess, ttl = 5 * 60) => {
    const key = `access:${userId}:${examId}`;
    return set(examCache, key, hasAccess ? "true" : "false", ttl);
  },

  // New helper methods for exam attempts
  getExamAttempt: async (userId, examId) => {
    const key = `attempt:${userId}:${examId}:active`;
    const result = await get(examCache, key);
    // No need to parse the result - it's already processed by the get method
    return result;
  },

  setExamAttempt: async (userId, examId, attemptData, ttl) => {
    const key = `attempt:${userId}:${examId}:active`;
    return set(examCache, key, JSON.stringify(attemptData), ttl);
  },

  // Method to store prepared questions for an attempt
  setPreparedQuestions: async (
    attemptId,
    preparedQuestions,
    examDetails,
    ttl = 5 * 60
  ) => {
    return set(
      examCache,
      `prepared:${attemptId}:questions`,
      {
        questions: preparedQuestions,
        exam: examDetails,
        timestamp: Date.now(),
      },
      ttl
    );
  },

  // Method to retrieve prepared questions for an attempt
  getPreparedQuestions: async (attemptId) => {
    return get(examCache, `prepared:${attemptId}:questions`);
  },

  // Bulk operations for exams
  bulkGetExams: async (examIds) => {
    try {
      const keys = examIds.map((id) => `exam:${id}`);
      const results = await examCache.mget(...keys);

      return results
        .map((data, index) => {
          if (!data) return null;
          try {
            return {
              id: examIds[index],
              data: JSON.parse(data),
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      console.error("Redis bulk get exams error:", error);
      return [];
    }
  },

  bulkSetExams: async (examsData, ttl = DEFAULT_TTL) => {
    try {
      const pipeline = examCache.pipeline();

      examsData.forEach(({ id, data }) => {
        pipeline.set(`exam:${id}`, JSON.stringify(data), "EX", ttl);
      });

      await pipeline.exec();
      return true;
    } catch (error) {
      console.error("Redis bulk set exams error:", error);
      return false;
    }
  },

  // Enhanced user-specific data caching with sharded keys
  getUserSpecificExamsCache: async (userId) => {
    // Ensure userId is a string
    const userIdStr = String(userId);

    // Shard key based on user ID to distribute keys across Redis cluster
    const shardId = parseInt(userIdStr.substring(0, 8), 16) % 16; // Create 16 shards
    return get(examCache, `categorized:${shardId}:${userIdStr}`);
  },

  setUserSpecificExamsCache: async (userId, data, ttl = 15 * 60) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 16;
    return set(examCache, `categorized:${shardId}:${userId}`, data, ttl);
  },

  clearUserSpecificExamsCache: async (userId) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 16;
    return del(examCache, `categorized:${shardId}:${userId}`);
  },

  // Client methods with improved batch handling
  getLatestExams: async (category, limit) =>
    get(examCache, `latest:${category}:${limit}`),

  setLatestExams: async (category, limit, examsData, ttl = DEFAULT_TTL) =>
    set(examCache, `latest:${category}:${limit}`, examsData, ttl),

  clearLatestExamsCache: async () => clearPattern(examCache, "latest:*"),

  // Bundle-specific methods with sharding
  getBundleCache: async (bundleId, userId) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 8;
    return get(examCache, `bundle:${shardId}:${bundleId}:${userId}`);
  },

  setBundleCache: async (bundleId, userId, bundleData, ttl = 15 * 60) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 8;
    return set(
      examCache,
      `bundle:${shardId}:${bundleId}:${userId}`,
      bundleData,
      ttl
    );
  },

  clearBundleCache: async (bundleId) => {
    const clearPromises = [];
    for (let i = 0; i < 8; i++) {
      clearPromises.push(clearPattern(examCache, `bundle:${i}:${bundleId}:*`));
    }
    await Promise.allSettled(clearPromises);
    return true;
  },

  clearAllBundleCache: async () => {
    const clearPromises = [];
    for (let i = 0; i < 8; i++) {
      clearPromises.push(clearPattern(examCache, `bundle:${i}:*`));
    }
    await Promise.allSettled(clearPromises);
    return true;
  },

  // Exam rules methods
  getExamRules: async (examId) => get(examCache, `rules:${examId}`),
  setExamRules: async (examId, rulesData, ttl = 24 * 60 * 60) =>
    set(examCache, `rules:${examId}`, rulesData, ttl),

  checkExamExists: async (examId) => {
    const exists = await get(examCache, `exists:${examId}`);
    return exists !== null ? exists : null;
  },

  setExamExists: async (examId, exists) =>
    set(examCache, `exists:${examId}`, exists, DEFAULT_TTL),
};

// Add methods that reference other methods separately
examService.clearCategorizedExamsCache = async () => {
  // Clear each shard separately to reduce Redis blocking
  const clearPromises = [];
  for (let i = 0; i < 16; i++) {
    clearPromises.push(clearPattern(examCache, `categorized:${i}:*`, 200));
  }
  await Promise.allSettled(clearPromises);
  return true;
};

examService.clearExamCache = async () => {
  // Split the work to avoid blocking Redis
  const tasks = [
    clearPattern(examCache, "exam:*", 500),
    examService.clearCategorizedExamsCache(), // Now safe to use
    clearPattern(examCache, "latest:*", 100),
  ];

  await Promise.allSettled(tasks);
  return true;
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

  // New methods for admin dashboard caching
  getDashboardUsers: async (cacheKey) => {
    try {
      return await get(userCache, cacheKey);
    } catch (error) {
      console.error("Cache error in getDashboardUsers:", error);
      return null;
    }
  },

  setDashboardUsers: async (cacheKey, responseData, ttl = 300) => {
    try {
      return await set(userCache, cacheKey, responseData, ttl);
    } catch (error) {
      console.error("Failed to cache dashboard users:", error);
      return false;
    }
  },

  // New methods for getting and setting user by ID
  getUserDetailsById: async (userId) => {
    try {
      const cacheKey = `admin:user:${userId}`;
      return await get(userCache, cacheKey);
    } catch (error) {
      console.error("Cache error in getUserDetailsById:", error);
      return null;
    }
  },

  setUserDetailsById: async (userId, userData, ttl = 300) => {
    try {
      const cacheKey = `admin:user:${userId}`;
      return await set(userCache, cacheKey, userData, ttl);
    } catch (error) {
      console.error("Failed to cache user details:", error);
      return false;
    }
  },
};

// Enhanced question service with read-through and write-behind caching
const questionService = {
  getQuestion: async (questionId) => get(questionCache, `q:${questionId}`),

  setQuestion: async (questionId, questionData, ttl = DEFAULT_TTL) =>
    set(questionCache, `q:${questionId}`, questionData, ttl),

  deleteQuestion: async (questionId) => del(questionCache, `q:${questionId}`),

  prefetchQuestionsForAttempt: async (attemptId, questionIds) => {
    // Batch load questions for a specific attempt
    try {
      const cacheKey = `attempt:${attemptId}:questions`;
      await set(questionCache, cacheKey, questionIds, 24 * 60 * 60); // Cache for the duration of the exam

      // Prefetch all questions in batch
      const pipeline = questionCache.pipeline();
      questionIds.forEach((id) => {
        pipeline.get(`q:${id}`);
      });

      const results = await pipeline.exec();
      const missingQuestions = [];

      // Identify which questions need to be loaded from database
      results.forEach((result, index) => {
        const [err, data] = result;
        if (err || !data) {
          missingQuestions.push(questionIds[index]);
        }
      });

      return missingQuestions.length === 0;
    } catch (error) {
      console.error(
        `Error prefetching questions for attempt ${attemptId}:`,
        error
      );
      return false;
    }
  },

  // Efficient batch loading for questions
  getQuestionsByExam: async (examId) => {
    // Try to get the list of question IDs for this exam
    const questionIds = await get(questionCache, `exam:${examId}:ids`);

    if (!questionIds) {
      return null; // No cached list of questions
    }

    // Batch load all questions
    try {
      const pipeline = questionCache.pipeline();
      questionIds.forEach((id) => {
        pipeline.get(`q:${id}`);
      });

      const results = await pipeline.exec();

      // Process results - handle any missing questions
      const questions = results
        .map(([err, data], index) => {
          if (err || !data) return null;
          try {
            return JSON.parse(data);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      // If we have all questions, return them
      if (questions.length === questionIds.length) {
        return questions;
      }

      // If some questions are missing, return null to trigger full reload
      return null;
    } catch (error) {
      console.error(`Error batch loading questions for exam ${examId}:`, error);
      return null;
    }
  },

  // Renamed from bulkGetExams to bulkGetQuestions for clarity
  bulkGetQuestions: async (questionIds) => {
    try {
      const keys = questionIds.map((id) => `q:${id}`);
      const results = await questionCache.mget(...keys);

      return results
        .map((data, index) => {
          if (!data) return null;
          try {
            return {
              id: questionIds[index],
              data: JSON.parse(data),
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      console.error("Redis bulk get questions error:", error);
      return [];
    }
  },

  // Renamed from bulkSetExams to bulkSetQuestions for clarity
  bulkSetQuestions: async (questionsData, ttl = DEFAULT_TTL) => {
    try {
      const pipeline = questionCache.pipeline();

      questionsData.forEach(({ id, data }) => {
        pipeline.set(`q:${id}`, JSON.stringify(data), "EX", ttl);
      });

      await pipeline.exec();
      return true;
    } catch (error) {
      console.error("Redis bulk set questions error:", error);
      return false;
    }
  },

  setQuestionsByExam: async (examId, questionsData, ttl = DEFAULT_TTL) => {
    try {
      // Store the list of question IDs separately
      const questionIds = questionsData.map((q) => q._id.toString());
      await set(questionCache, `exam:${examId}:ids`, questionIds, ttl);

      // Store each question individually with pipeline
      const pipeline = questionCache.pipeline();
      questionsData.forEach((question) => {
        const questionId = question._id.toString();
        pipeline.set(`q:${questionId}`, JSON.stringify(question), "EX", ttl);
      });

      await pipeline.exec();
      return true;
    } catch (error) {
      console.error(`Error caching questions for exam ${examId}:`, error);
      return false;
    }
  },

  deleteQuestionsByExam: async (examId) =>
    del(questionCache, `exam:${examId}:ids`),

  clearQuestionCache: async () => clearPattern(questionCache, "*"),

  // Add prefetching capabilities for exam questions
  prefetchQuestionsForExam: async (examId, questions) => {
    // Add to batch queue for async processing
    return addToBatchQueue("question_prefetch", {
      examId,
      questionIds: questions.map((q) => q._id.toString()),
    });
  },
};

// Enhanced exam attempt service with optimizations for concurrent users
const attemptService = {
  // Basic attempt operations
  getAttempt: async (attemptId) => get(examCache, `attempt:${attemptId}`),

  setAttempt: async (attemptId, attemptData, ttl = DEFAULT_TTL) => {
    // For active attempts, use shorter TTL to ensure freshness
    const actualTtl =
      attemptData.status === "in-progress" ? Math.min(ttl, 5 * 60) : ttl;
    return set(examCache, `attempt:${attemptId}`, attemptData, actualTtl);
  },

  deleteAttempt: async (attemptId) => del(examCache, `attempt:${attemptId}`),

  getAttemptStatus: async (attemptId) => get(examCache, `status:${attemptId}`),
  setAttemptStatus: async (attemptId, status, ttl = 60) =>
    set(examCache, `status:${attemptId}`, status, ttl),

  batchGetQuestionsForAttempt: async (attemptId) => {
    try {
      // Get question IDs for this attempt
      const questionIds = await get(
        questionCache,
        `attempt:${attemptId}:questions`
      );
      if (!questionIds || !Array.isArray(questionIds)) {
        return null;
      }

      // Batch load all questions
      const pipeline = questionCache.pipeline();
      questionIds.forEach((id) => {
        pipeline.get(`q:${id}`);
      });

      const results = await pipeline.exec();

      // Process results - handle any missing questions
      return results
        .map(([err, data], index) => {
          if (err || !data) return null;
          try {
            const question = JSON.parse(data);
            return {
              id: questionIds[index],
              data: question,
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      console.error(
        `Error batch getting questions for attempt ${attemptId}:`,
        error
      );
      return null;
    }
  },

  // Fixed queue name to match the worker process setup
  batchSaveAnswers: async (attemptId, answers) => {
    try {
      // Queue the answers for batch processing - using consistent queue name "answer_updates"
      await addToBatchQueue("answer_updates", {
        attemptId,
        answers,
        timestamp: Date.now(),
      });

      // Also update cache for immediate consistency
      const cacheKey = `attempt:${attemptId}:answers`;
      const currentAnswers = (await get(examCache, cacheKey)) || {};

      // Update answers in cache
      answers.forEach((answer) => {
        currentAnswers[answer.questionId] = answer;
      });

      // Save back to cache with short TTL
      await set(examCache, cacheKey, currentAnswers, 5 * 60);

      return true;
    } catch (error) {
      console.error(
        `Error queueing batch answers for attempt ${attemptId}:`,
        error
      );
      return false;
    }
  },

  // Store active attempts separately with very short TTL for high consistency
  updateActiveAttempt: async (attemptId, updates) => {
    try {
      // Get current data
      const current = await get(examCache, `attempt:${attemptId}`);
      if (!current) return false;

      // Only update specified fields
      const updated = { ...current, ...updates };

      // Use short TTL for active attempts to prevent stale data
      return set(examCache, `attempt:${attemptId}`, updated, 5 * 60);
    } catch (error) {
      console.error(`Error updating active attempt ${attemptId}:`, error);
      return false;
    }
  },

  // Get user's attempts by examId with sharding
  getUserAttemptsByExam: async (userId, examId) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 8;
    return get(examCache, `attempts:${shardId}:user:${userId}:exam:${examId}`);
  },

  setUserAttemptsByExam: async (userId, examId, attemptsData, ttl = 5 * 60) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 8;
    return set(
      examCache,
      `attempts:${shardId}:user:${userId}:exam:${examId}`,
      attemptsData,
      ttl
    );
  },

  // Handle exam rankings with efficient caching
  getExamRankings: async (examId) => get(examCache, `rankings:${examId}`),

  setExamRankings: async (examId, rankingsData, ttl = 60 * 60) =>
    set(examCache, `rankings:${examId}`, rankingsData, ttl),

  // Clear user attempts with sharding
  clearUserAttempts: async (userId) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 8;
    return clearPattern(examCache, `attempts:${shardId}:user:${userId}:*`);
  },

  // Clear exam rankings
  clearExamRankings: async (examId) => del(examCache, `rankings:${examId}`),

  // Optimized for multiple concurrent saves (used by submit-exam)
  incrementAttemptCount: async (examId) => {
    try {
      return await analyticsCache.hincrby(
        `exam:${examId}:counters`,
        "attempts",
        1
      );
    } catch (error) {
      console.error(
        `Failed to increment attempt count for exam ${examId}:`,
        error
      );
      return null;
    }
  },

  // Add these methods to the attemptService object

  getAttemptTimer: async (attemptId) => {
    return get(examCache, `timer:${attemptId}`);
  },

  setAttemptTimer: async (attemptId, timerData, ttl = 3600) => {
    return set(examCache, `timer:${attemptId}`, timerData, ttl);
  },

  // Calculate current time remaining based on absolute end time
  getCurrentTimeRemaining: async (attemptId) => {
    try {
      // Change this line:
      // const timerData = await attemptService.get(attemptService.examCache, `timer:${attemptId}`);

      // To this:
      const timerData = await get(examCache, `timer:${attemptId}`);

      if (!timerData) {
        // Try to get time from the database as fallback
        try {
          const ExamAttempt = (await import("../models/examAttempt.models.js"))
            .default;
          const attempt = await ExamAttempt.findById(attemptId)
            .select("timeRemaining")
            .lean();

          if (attempt) {
            return attempt.timeRemaining;
          }
        } catch (dbError) {
          console.error(`Error retrieving attempt from database: ${dbError}`);
        }
        return null;
      }

      // Safely check for absoluteEndTime
      const endTime = timerData.absoluteEndTime;
      if (!endTime || typeof endTime !== "number") {
        return timerData.timeRemaining || null; // Fall back to timeRemaining if available
      }

      // Calculate time remaining based on current server time and stored end time
      const timeRemaining = Math.max(
        0,
        Math.floor((endTime - Date.now()) / 1000)
      );

      return timeRemaining;
    } catch (error) {
      console.error(
        `Error calculating time remaining for ${attemptId}:`,
        error
      );
      return null;
    }
  },

  // Queue timer sync for background processing
  queueTimerSync: async (attemptId, timeRemaining, userId) => {
    try {
      return await addToBatchQueue("timer_sync", {
        attemptId,
        timeRemaining,
        userId,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`Error queueing timer sync for ${attemptId}:`, error);
      return false; // Continue execution even if queueing fails
    }
  },

  // Queue timed-out exam for immediate processing
  queueTimedOutExam: async (attemptId) => {
    try {
      return await addToBatchQueue("timed_out_exams", {
        attemptId,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`Error queueing timed-out exam ${attemptId}:`, error);
      return false;
    }
  },
};

// Enhanced analytics service with batching
const analyticsService = {
  getAnalytics: async (examId) => get(analyticsCache, examId),

  setAnalytics: async (examId, analyticsData, ttl = DEFAULT_TTL) =>
    set(analyticsCache, examId, analyticsData, ttl),

  deleteAnalytics: async (examId) => del(analyticsCache, examId),

  clearAnalyticsCache: async () => clearPattern(analyticsCache, "*"),

  // Add batched analytics updates
  queueAnalyticsUpdate: async (examId, updateData = {}) => {
    return addToBatchQueue("analytics_update", {
      examId,
      ...updateData,
      timestamp: Date.now(),
    });
  },

  // Method to process analytics update queue
  processAnalyticsQueue: async () => {
    return processBatchQueue("analytics_update", async (items) => {
      // Group updates by examId for batch processing
      const updatesByExam = {};

      items.forEach((item) => {
        const { examId } = item.data;
        if (!updatesByExam[examId]) {
          updatesByExam[examId] = [];
        }
        updatesByExam[examId].push(item.data);
      });

      // Process each exam's analytics updates in a single operation
      const updatePromises = Object.entries(updatesByExam).map(
        async ([examId, updates]) => {
          try {
            // Aggregate the updates
            const aggregatedUpdates = {
              totalAttempted: 0,
              totalCompleted: 0,
              passCount: 0,
              failCount: 0,
              scores: [], // For recalculating averages
            };

            updates.forEach((update) => {
              if (update.completed) aggregatedUpdates.totalCompleted++;
              if (update.attempted) aggregatedUpdates.totalAttempted++;
              if (update.passed) aggregatedUpdates.passCount++;
              if (update.failed) aggregatedUpdates.failCount++;
              if (update.score !== undefined)
                aggregatedUpdates.scores.push(update.score);
            });

            // Update in cache
            await analyticsCache.hincrby(
              examId,
              "totalAttempted",
              aggregatedUpdates.totalAttempted
            );
            await analyticsCache.hincrby(
              examId,
              "totalCompleted",
              aggregatedUpdates.totalCompleted
            );
            await analyticsCache.hincrby(
              examId,
              "passCount",
              aggregatedUpdates.passCount
            );
            await analyticsCache.hincrby(
              examId,
              "failCount",
              aggregatedUpdates.failCount
            );

            // Update averages and other metrics in database (this would be done in a DB worker)
            // For this example, we'll just mark it as needing an update
            await analyticsCache.hset(examId, "needsDbSync", "true");
          } catch (error) {
            console.error(
              `Error processing analytics updates for exam ${examId}:`,
              error
            );
          }
        }
      );

      await Promise.allSettled(updatePromises);
    });
  },

  bulkGetAnalytics: async (examIds) => {
    try {
      const analyticsPromises = examIds.map((id) =>
        analyticsService.getAnalytics(id.toString())
      );
      const results = await Promise.all(analyticsPromises);

      return results
        .map((data, index) => {
          if (!data) return null;
          return {
            examId: examIds[index].toString(),
            data,
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.error("Redis bulk get analytics error:", error);
      return [];
    }
  },
};

// Enhanced payment service with sharding
const paymentService = {
  // Get user's access to exams with sharding
  getUserExamAccess: async (userId) => {
    const userIdStr = String(userId);

    const shardId = parseInt(userIdStr.substring(0, 8), 16) % 16;
    return get(paymentCache, `access:${shardId}:${userId}`);
  },

  // Set user's access to exams
  setUserExamAccess: async (userId, accessMap, ttl = 5 * 60) => {
    const userIdStr = String(userId);

    const shardId = parseInt(userIdStr.substring(0, 8), 16) % 16;
    return set(paymentCache, `access:${shardId}:${userId}`, accessMap, ttl);
  },

  // Clear a user's access cache
  clearUserExamAccess: async (userId) => {
    const shardId = parseInt(userId.substring(0, 8), 16) % 16;
    return del(paymentCache, `access:${shardId}:${userId}`);
  },

  // Clear access cache for all users with sharding
  clearAllExamAccess: async () => {
    const clearPromises = [];
    for (let i = 0; i < 16; i++) {
      clearPromises.push(clearPattern(paymentCache, `access:${i}:*`));
    }
    await Promise.allSettled(clearPromises);
    return true;
  },

  // Batch check access for multiple exams
  batchCheckAccess: async (userId, examIds) => {
    try {
      // Get access map from cache
      const shardId = parseInt(userId.substring(0, 8), 16) % 16;
      const accessMap = await get(paymentCache, `access:${shardId}:${userId}`);

      if (!accessMap) {
        return null; // Not cached, will need database check
      }

      // Check access for each exam
      return examIds.reduce((result, examId) => {
        result[examId] = !!accessMap[examId];
        return result;
      }, {});
    } catch (error) {
      console.error(`Error batch checking access for user ${userId}:`, error);
      return null;
    }
  },
};

const publicationService = {
  // Get all active publications
  getActivePublications: async () => {
    return get(publicationCache, "active:publications");
  },

  // Set active publications cache
  setActivePublications: async (publications, ttl = 60 * 15) => {
    // 15 minutes
    return set(publicationCache, "active:publications", publications, ttl);
  },

  // Get publications for a specific exam
  getExamPublications: async (examId) => {
    return get(publicationCache, `exam:${examId}:publications`);
  },

  // Set publications for a specific exam
  setExamPublications: async (examId, publications, ttl = 60 * 5) => {
    // 5 minutes
    return set(
      publicationCache,
      `exam:${examId}:publications`,
      publications,
      ttl
    );
  },

  // Clear exam publications cache
  clearExamPublications: async (examId) => {
    return del(publicationCache, `exam:${examId}:publications`);
  },

  // Clear all publications cache
  clearAllPublicationsCache: async () => {
    await Promise.all([
      del(publicationCache, "active:publications"),
      clearPattern(publicationCache, "exam:*:publications"),
    ]);
    return true;
  },
};

// Health check method with improved diagnostics
const checkHealth = async () => {
  try {
    // Check all Redis clients
    const [
      examResult,
      userResult,
      questionResult,
      analyticsResult,
      paymentResult,
    ] = await Promise.all([
      examCache.ping(),
      userCache.ping(),
      questionCache.ping(),
      analyticsCache.ping(),
      paymentCache.ping(),
    ]);

    const allHealthy =
      examResult === "PONG" &&
      userResult === "PONG" &&
      questionResult === "PONG" &&
      analyticsResult === "PONG" &&
      paymentResult === "PONG";

    // Return detailed health status
    return {
      healthy: allHealthy,
      services: {
        exam: examResult === "PONG",
        user: userResult === "PONG",
        question: questionResult === "PONG",
        analytics: analyticsResult === "PONG",
        payment: paymentResult === "PONG",
      },
    };
  } catch (error) {
    console.error(`Redis health check failed:`, error.message);
    return {
      healthy: false,
      error: error.message,
    };
  }
};

// Setup background workers for batch processing
const setupBackgroundWorkers = () => {
  // Process analytics updates
  setInterval(async () => {
    try {
      const processed = await analyticsService.processAnalyticsQueue();
      if (processed > 0) {
        console.log(`Processed ${processed} analytics updates`);
      }
    } catch (error) {
      console.error("Error processing analytics batch queue:", error);
    }
  }, BATCH_INTERVAL);

  // Process answer batch saves - fixed to use same queue name as batchSaveAnswers
  setInterval(async () => {
    try {
      const processed = await processBatchQueue(
        "answer_updates",
        async (items) => {
          // Group by attemptId
          const updatesByAttempt = {};

          items.forEach((item) => {
            const { attemptId, answers } = item.data;
            if (!updatesByAttempt[attemptId]) {
              updatesByAttempt[attemptId] = [];
            }
            updatesByAttempt[attemptId].push(...answers);
          });

          // Process each attempt's answers
          await Promise.allSettled(
            Object.entries(updatesByAttempt).map(
              async ([attemptId, answers]) => {
                // This would update the database directly
                // In a real implementation, this would call a database service
                console.log(
                  `Batched save of ${answers.length} answers for attempt ${attemptId}`
                );
              }
            )
          );
        }
      );

      if (processed > 0) {
        console.log(`Processed ${processed} batched answer updates`);
      }
    } catch (error) {
      console.error("Error processing answer updates batch queue:", error);
    }
  }, BATCH_INTERVAL / 2); // Process answers more frequently
};

// Start background workers if we're in the main process
if (process.env.NODE_ENV === "production" && !process.env.WORKER_ONLY) {
  setupBackgroundWorkers();
}

export {
  examService,
  userService,
  questionService,
  attemptService,
  analyticsService,
  paymentService,
  checkHealth,
  addToBatchQueue,
  processBatchQueue,
  publicationService,
  publicationCache,
};
