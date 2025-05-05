// src/workers/index.js - Enhanced worker process for background tasks
import { connectDB } from "../lib/connectDB.js";
import {
  analyticsService,
  processBatchQueue,
  attemptService,
} from "../services/redisService.js";
import ExamAnalytics from "../models/examAnalytics.models.js";
import ExamAttempt from "../models/examAttempt.models.js";
import Question from "../models/questions.models.js";
import mongoose from "mongoose";

// Connect to databases
const startWorker = async () => {
  try {
    await connectDB();
    console.log("Worker connected to database");

    // Start processing background tasks
    startBackgroundTasks();
  } catch (error) {
    console.error("Error starting worker:", error);
    process.exit(1);
  }
};

// Background task processing
const startBackgroundTasks = () => {
  // Process analytics updates
  setInterval(async () => {
    try {
      const processed = await analyticsService.processAnalyticsQueue();
      if (processed > 0) {
        console.log(`[Worker] Processed ${processed} analytics updates`);

        // Sync analytics with database
        await syncAnalyticsToDb();
      }
    } catch (error) {
      console.error("[Worker] Error processing analytics batch queue:", error);
    }
  }, 5000); // Every 5 seconds

  // Process DB syncs for analytics
  setInterval(async () => {
    try {
      await syncAnalyticsToDb();
    } catch (error) {
      console.error("[Worker] Error syncing analytics to database:", error);
    }
  }, 60000); // Every minute

  // Process batched answer submissions
  setInterval(async () => {
    try {
      const processed = await processBatchedAnswers();
      if (processed > 0) {
        console.log(`[Worker] Processed ${processed} batched answers`);
      }
    } catch (error) {
      console.error("[Worker] Error processing batched answers:", error);
    }
  }, 2000); // Every 2 seconds

  // Process adaptive timer sync for active exams
  setInterval(async () => {
    try {
      const processed = await syncActiveExamTimers();
      if (processed > 0) {
        console.log(`[Worker] Synced timers for ${processed} active exams`);
      }
    } catch (error) {
      console.error("[Worker] Error syncing exam timers:", error);
    }
  }, 30000); // Every 30 seconds

  console.log("Worker started background tasks");
};

// Sync Redis analytics to MongoDB
const syncAnalyticsToDb = async () => {
  try {
    // Get all analytics keys that need syncing
    const keys = await analyticsService.analyticsCache.keys("*needsDbSync*");

    if (keys.length === 0) {
      return 0;
    }

    console.log(
      `[Worker] Syncing ${keys.length} analytics records to database`
    );

    for (const key of keys) {
      try {
        // Get the exam ID from the key
        const examId = key.split(":")[1];
        if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
          continue;
        }

        // Get all analytics data for this exam
        const analyticsData = await analyticsService.analyticsCache.hgetall(
          key
        );

        if (!analyticsData) {
          continue;
        }

        // Update database
        await ExamAnalytics.findOneAndUpdate(
          { examId },
          {
            $set: {
              totalAttempted: parseInt(analyticsData.totalAttempted || 0),
              totalCompleted: parseInt(analyticsData.totalCompleted || 0),
              passCount: parseInt(analyticsData.passCount || 0),
              failCount: parseInt(analyticsData.failCount || 0),
              // Calculate percentages
              passPercentage:
                analyticsData.totalCompleted > 0
                  ? (parseInt(analyticsData.passCount || 0) /
                      parseInt(analyticsData.totalCompleted || 1)) *
                    100
                  : 0,
              failPercentage:
                analyticsData.totalCompleted > 0
                  ? (parseInt(analyticsData.failCount || 0) /
                      parseInt(analyticsData.totalCompleted || 1)) *
                    100
                  : 0,
            },
          },
          { upsert: true }
        );

        // Clear the needsDbSync flag
        await analyticsService.analyticsCache.hdel(key, "needsDbSync");
      } catch (error) {
        console.error(
          `[Worker] Error syncing analytics for key ${key}:`,
          error
        );
      }
    }

    return keys.length;
  } catch (error) {
    console.error("[Worker] Error in syncAnalyticsToDb:", error);
    return 0;
  }
};

// Process batched answer submissions from the frontend
const processBatchedAnswers = async () => {
  try {
    // Get batch queue keys
    const batchQueueKey = "batch:answers";

    // Create processor function for batch items
    const processor = async (batchItem) => {
      const { attemptId, answers } = batchItem;

      if (!attemptId || !answers || !Array.isArray(answers)) {
        throw new Error("Invalid batch item format");
      }

      // Get the exam attempt
      const attempt = await ExamAttempt.findById(attemptId)
        .select("userId answers")
        .lean();

      if (!attempt) {
        throw new Error(`Exam attempt ${attemptId} not found`);
      }

      // Process each answer in the batch
      for (const answer of answers) {
        const { questionId, selectedOption, responseTime } = answer;

        // Find the index of this question in the attempt's answers array
        const answerIndex = attempt.answers.findIndex(
          (a) => a.questionId.toString() === questionId
        );

        if (answerIndex === -1) {
          continue; // Skip if question not found
        }

        // Update the answer in the database
        await ExamAttempt.updateOne(
          { _id: attemptId, "answers.questionId": questionId },
          {
            $set: {
              "answers.$.selectedOption": selectedOption,
              "answers.$.responseTime": responseTime || 0,
            },
          }
        );

        // Update cache if applicable
        await attemptService.setAnswerCache(
          attemptId,
          questionId,
          selectedOption,
          responseTime || 0
        );
      }
    };

    // Process batches
    return await attemptService.attemptCache.batchProcess(
      batchQueueKey,
      processor,
      { batchSize: 100 }
    );
  } catch (error) {
    console.error("[Worker] Error processing batched answers:", error);
    return 0;
  }
};

// Sync active exam timers
const syncActiveExamTimers = async () => {
  try {
    // Find active exams that need timer sync
    const activeExams = await ExamAttempt.find({
      status: "in-progress",
      // Only sync exams that haven't been updated in the last minute
      updatedAt: { $lt: new Date(Date.now() - 60000) },
    })
      .select("_id timeRemaining")
      .lean();

    if (activeExams.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const exam of activeExams) {
      try {
        // Get latest time from cache
        const cachedTime = await attemptService.getTimeRemaining(exam._id);

        if (cachedTime !== null && cachedTime !== exam.timeRemaining) {
          // Update database with cached time
          await ExamAttempt.updateOne(
            { _id: exam._id },
            { $set: { timeRemaining: cachedTime } }
          );

          processed++;
        }
      } catch (err) {
        console.error(
          `[Worker] Error syncing timer for exam ${exam._id}:`,
          err
        );
      }
    }

    return processed;
  } catch (error) {
    console.error("[Worker] Error syncing active exam timers:", error);
    return 0;
  }
};

// Handle graceful shutdown
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function gracefulShutdown() {
  console.log("[Worker] Starting graceful shutdown...");

  try {
    // Close database connections
    await mongoose.connection.close();
    console.log("[Worker] MongoDB connection closed");
    process.exit(0);
  } catch (error) {
    console.error("[Worker] Error during shutdown:", error);
    process.exit(1);
  }
}

// Start the worker
startWorker();
