// src/workers/index.js - Worker process for background tasks
import { connectDB } from "../lib/connectDB.js";
import {
  analyticsService,
  processBatchQueue,
} from "../services/redisService.js";
import ExamAnalytics from "../models/examAnalytics.models.js";
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

  // Other background tasks can be added here

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
