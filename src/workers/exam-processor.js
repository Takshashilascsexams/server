import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB, monitorConnectionPool } from "../lib/connectDB.js";
import ExamAttempt from "../models/examAttempt.models.js";
import Exam from "../models/exam.models.js";
import {
  processBatchQueue,
  examService,
  publicationService,
} from "../services/redisService.js";
import { processExamSubmission } from "../utils/processExamSubmission.js";

dotenv.config();

// Simple but effective configuration
const PROCESSING_INTERVAL = 1500; // 1.5 seconds (faster than 3s, but not too aggressive)
const BATCH_SIZE = 5; // Process 5 submissions at once (manageable batch size)
const MAX_CONCURRENT = 3; // Max 3 concurrent operations (safe limit)

// Connect to databases
const startExamProcessor = async () => {
  try {
    await connectDB();
    console.log(
      "✅ [Exam Processor] Connected to database with enhanced connection pool"
    );

    // Log initial connection stats
    const connectionStats = await monitorConnectionPool();
    console.log(
      `📊 [Exam Processor] DB Pool: ${connectionStats.current}/${connectionStats.maxPoolSize} (${connectionStats.poolUtilization})`
    );

    // Start simple but optimized processing
    processExamsOptimized();
  } catch (error) {
    console.error("❌ [Exam Processor] Error starting worker:", error);
    process.exit(1);
  }
};

// Optimized processing with controlled concurrency
const processExamsOptimized = () => {
  let activeProcessing = 0;
  let totalProcessed = 0;

  setInterval(async () => {
    try {
      // Simple concurrency control
      if (activeProcessing >= MAX_CONCURRENT) {
        console.log(
          `⏳ [Exam Processor] Processing limit reached (${activeProcessing}/${MAX_CONCURRENT}), waiting...`
        );
        return;
      }

      activeProcessing++;
      const processed = await processExamBatchImproved();
      activeProcessing--;

      if (processed > 0) {
        totalProcessed += processed;
        console.log(
          `✅ [Exam Processor] Processed ${processed} submissions (Total: ${totalProcessed})`
        );
      }

      // Simple performance monitoring
      if (totalProcessed % 50 === 0 && totalProcessed > 0) {
        const stats = await monitorConnectionPool();
        console.log(
          `📊 [Exam Processor] Performance check - DB: ${stats.poolUtilization}, Total processed: ${totalProcessed}`
        );
      }
    } catch (error) {
      activeProcessing = Math.max(0, activeProcessing - 1); // Ensure we don't go negative
      console.error("❌ [Exam Processor] Error in processing cycle:", error);
    }
  }, PROCESSING_INTERVAL);
};

// Improved batch processing without over-engineering
// const processExamBatchImproved = async () => {
//   try {
//     return await processBatchQueue("exam_submissions", async (items) => {
//       // Process reasonable batch size
//       const batchItems = items.slice(0, BATCH_SIZE);

//       if (batchItems.length === 0) {
//         return 0;
//       }

//       console.log(
//         `🔄 [Exam Processor] Processing batch of ${batchItems.length} exam submissions`
//       );

//       // Process items concurrently but with simple error handling
//       const processPromises = batchItems.map(async (item) => {
//         const { attemptId, userId } = item.data;

//         try {
//           // Get the attempt
//           const attempt = await ExamAttempt.findOne({
//             _id: attemptId,
//             userId,
//             status: "processing",
//           });

//           if (!attempt) {
//             console.log(
//               `⚠️ [Exam Processor] Attempt ${attemptId} not found or not in processing state`
//             );
//             return false;
//           }

//           // Get the exam
//           const exam = await Exam.findById(attempt.examId);
//           if (!exam) {
//             console.error(
//               `❌ [Exam Processor] Exam not found for attempt ${attemptId}`
//             );
//             return false;
//           }

//           // Simple transaction with basic retry
//           let success = false;
//           let retryCount = 0;
//           const maxRetries = 2; // Just 2 retries to keep it simple

//           while (!success && retryCount < maxRetries) {
//             const session = await mongoose.startSession();

//             try {
//               session.startTransaction();

//               // Process with simple timeout
//               const timeoutPromise = new Promise(
//                 (_, reject) =>
//                   setTimeout(
//                     () => reject(new Error("Processing timeout")),
//                     20000
//                   ) // 20 second timeout
//               );

//               const result = await Promise.race([
//                 processExamSubmission(attemptId, attempt, exam, session),
//                 timeoutPromise,
//               ]);

//               await session.commitTransaction();
//               session.endSession();

//               // ✅ CLEAR CACHE AFTER SUCCESSFUL PROCESSING
//               // Clear all three caches
//               try {
//                 const [userCacheResult, latestCacheResult, bundleCacheResult] =
//                   await Promise.allSettled([
//                     examService.clearUserSpecificExamsCache(userIdString),
//                     examService.clearLatestExamsCache(),
//                     examService.clearAllBundleCache(),
//                   ]);

//                 // Log results for each cache operation
//                 if (userCacheResult.status === "fulfilled") {
//                   console.log(
//                     `🧹 [Exam Processor] Cleared user-specific exam cache for user ${userIdString}`
//                   );
//                 } else {
//                   console.warn(
//                     `⚠️ [Exam Processor] Failed to clear user-specific cache for user ${userIdString}:`,
//                     userCacheResult.reason
//                   );
//                 }

//                 if (latestCacheResult.status === "fulfilled") {
//                   console.log(`🧹 [Exam Processor] Cleared latest exams cache`);
//                 } else {
//                   console.warn(
//                     `⚠️ [Exam Processor] Failed to clear latest exams cache:`,
//                     latestCacheResult.reason
//                   );
//                 }

//                 if (bundleCacheResult.status === "fulfilled") {
//                   console.log(`🧹 [Exam Processor] Cleared all bundle cache`);
//                 } else {
//                   console.warn(
//                     `⚠️ [Exam Processor] Failed to clear bundle cache:`,
//                     bundleCacheResult.reason
//                   );
//                 }
//               } catch (error) {
//                 // This catch block should rarely execute since we're using Promise.allSettled
//                 console.error(
//                   `❌ [Exam Processor] Unexpected error during cache clearing for user ${userIdString}:`,
//                   error
//                 );
//               }

//               console.log(
//                 `✅ [Exam Processor] Processed exam ${attemptId} - Score: ${result.finalScore}/${exam.totalMarks}`
//               );
//               success = true;
//               return true;
//             } catch (error) {
//               await session.abortTransaction();
//               session.endSession();

//               retryCount++;
//               if (retryCount >= maxRetries) {
//                 console.error(
//                   `❌ [Exam Processor] Failed to process exam ${attemptId} after ${maxRetries} retries:`,
//                   error.message
//                 );

//                 // Simple error marking
//                 await ExamAttempt.updateOne(
//                   { _id: attemptId },
//                   {
//                     $set: {
//                       status: "error",
//                       processingError: error.message,
//                       errorTimestamp: new Date(),
//                     },
//                   }
//                 );
//                 return false;
//               } else {
//                 console.warn(
//                   `⚠️ [Exam Processor] Retry ${retryCount} for exam ${attemptId}: ${error.message}`
//                 );
//                 // Simple delay before retry
//                 await new Promise((resolve) => setTimeout(resolve, 2000));
//               }
//             }
//           }

//           return false;
//         } catch (error) {
//           console.error(
//             `❌ [Exam Processor] Error processing attempt ${attemptId}:`,
//             error
//           );
//           return false;
//         }
//       });

//       // Wait for all processing with simple result counting
//       const results = await Promise.allSettled(processPromises);
//       const successful = results.filter(
//         (r) => r.status === "fulfilled" && r.value === true
//       ).length;

//       return successful;
//     });
//   } catch (error) {
//     console.error("❌ [Exam Processor] Error in batch processing:", error);
//     return 0;
//   }
// };

// ✅ UPDATED HELPER FUNCTION: Cache clearing with user attempts invalidation
const clearExamCaches = async (userId) => {
  try {
    const userIdString = userId.toString();

    // Import publicationService if not already imported
    const { publicationService } = await import("../services/redisService.js");

    const [
      userCacheResult,
      latestCacheResult,
      bundleCacheResult,
      userAttemptsResult,
    ] = await Promise.allSettled([
      examService.clearUserSpecificExamsCache(userIdString),
      examService.clearLatestExamsCache(),
      examService.clearAllBundleCache(),
      publicationService.clearUserExamAttempts(userIdString), // 🆕 Clear user's exam attempts cache
    ]);

    // Log results with detailed status
    const cacheOperations = [
      {
        name: "user-specific exams",
        result: userCacheResult,
        userId: userIdString,
      },
      { name: "latest exams", result: latestCacheResult },
      { name: "bundle", result: bundleCacheResult },
      {
        name: "user exam attempts",
        result: userAttemptsResult,
        userId: userIdString,
      }, // 🆕 New cache operation
    ];

    cacheOperations.forEach(({ name, result, userId }) => {
      if (result.status === "fulfilled") {
        const userInfo = userId ? ` for user ${userId}` : "";
        console.log(`🧹 [Exam Processor] Cleared ${name} cache${userInfo}`);
      } else {
        const userInfo = userId ? ` for user ${userId}` : "";
        console.warn(
          `⚠️ [Exam Processor] Failed to clear ${name} cache${userInfo}:`,
          result.reason
        );
      }
    });

    const successCount = cacheOperations.filter(
      (op) => op.result.status === "fulfilled"
    ).length;
    console.log(
      `🧹 [Exam Processor] Cache clearing completed: ${successCount}/4 operations successful` // Updated count
    );
  } catch (error) {
    console.error(
      `❌ [Exam Processor] Unexpected cache clearing error:`,
      error
    );
  }
};

// ✅ HELPER FUNCTION: Clean transaction processing
const processExamWithTransaction = async (attemptId, attempt, exam, userId) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Set timeout for processing
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Processing timeout")), 20000)
    );

    const result = await Promise.race([
      processExamSubmission(attemptId, attempt, exam, session),
      timeoutPromise,
    ]);

    await session.commitTransaction();

    // Clear cache after successful commit (outside transaction)
    await clearExamCaches(userId);

    console.log(
      `✅ [Exam Processor] Processed exam ${attemptId} - Score: ${result.finalScore}/${exam.totalMarks}`
    );
    return { success: true, result };
  } catch (error) {
    // Only abort if transaction is still active
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ✅ UPDATED MAIN FUNCTION: Clean and robust
const processExamBatchImproved = async () => {
  try {
    return await processBatchQueue("exam_submissions", async (items) => {
      // Process reasonable batch size
      const batchItems = items.slice(0, BATCH_SIZE);

      if (batchItems.length === 0) {
        return 0;
      }

      console.log(
        `🔄 [Exam Processor] Processing batch of ${batchItems.length} exam submissions`
      );

      // Process items concurrently with clean error handling
      const processPromises = batchItems.map(async (item) => {
        const { attemptId, userId } = item.data;

        try {
          // Get the attempt
          const attempt = await ExamAttempt.findOne({
            _id: attemptId,
            userId,
            status: "processing",
          });

          if (!attempt) {
            console.log(
              `⚠️ [Exam Processor] Attempt ${attemptId} not found or not in processing state`
            );
            return false;
          }

          // Get the exam
          const exam = await Exam.findById(attempt.examId);
          if (!exam) {
            console.error(
              `❌ [Exam Processor] Exam not found for attempt ${attemptId}`
            );
            return false;
          }

          // Clean transaction processing with retry logic
          let success = false;
          let retryCount = 0;
          const maxRetries = 2;

          while (!success && retryCount < maxRetries) {
            try {
              // Use the clean transaction helper
              const result = await processExamWithTransaction(
                attemptId,
                attempt,
                exam,
                userId
              );
              success = true;
              return true;
            } catch (error) {
              retryCount++;

              if (retryCount >= maxRetries) {
                console.error(
                  `❌ [Exam Processor] Failed to process exam ${attemptId} after ${maxRetries} retries:`,
                  error.message
                );

                // Mark as error in database
                await ExamAttempt.updateOne(
                  { _id: attemptId },
                  {
                    $set: {
                      status: "error",
                      processingError: error.message,
                      errorTimestamp: new Date(),
                    },
                  }
                );
                return false;
              } else {
                console.warn(
                  `⚠️ [Exam Processor] Retry ${retryCount} for exam ${attemptId}: ${error.message}`
                );
                // Simple delay before retry
                await new Promise((resolve) => setTimeout(resolve, 2000));
              }
            }
          }

          return false;
        } catch (error) {
          console.error(
            `❌ [Exam Processor] Error processing attempt ${attemptId}:`,
            error
          );
          return false;
        }
      });

      // Wait for all processing with simple result counting
      const results = await Promise.allSettled(processPromises);
      const successful = results.filter(
        (r) => r.status === "fulfilled" && r.value === true
      ).length;

      return successful;
    });
  } catch (error) {
    console.error("❌ [Exam Processor] Error in batch processing:", error);
    return 0;
  }
};

// Simple monitoring function
const logPerformanceStats = () => {
  setInterval(async () => {
    try {
      const stats = await monitorConnectionPool();
      const memUsage = process.memoryUsage();

      console.log(`📊 [Exam Processor] Health Check:`, {
        dbConnections: `${stats.current}/${stats.maxPoolSize}`,
        dbUtilization: stats.poolUtilization,
        memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        uptime: Math.round(process.uptime() / 60) + "m",
      });

      // Simple memory warning
      if (memUsage.heapUsed > 400 * 1024 * 1024) {
        // 400MB
        console.warn(
          `⚠️ [Exam Processor] High memory usage: ${Math.round(
            memUsage.heapUsed / 1024 / 1024
          )}MB`
        );
      }
    } catch (error) {
      console.error("❌ [Exam Processor] Error in health check:", error);
    }
  }, 60000); // Every minute
};

// Simple graceful shutdown
const gracefulShutdown = async () => {
  console.log("🛑 [Exam Processor] Starting graceful shutdown...");

  try {
    // Simple shutdown - just close the DB connection
    await mongoose.connection.close();
    console.log("✅ [Exam Processor] Shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("❌ [Exam Processor] Error during shutdown:", error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Start performance monitoring
logPerformanceStats();

// Start the processor
startExamProcessor();
