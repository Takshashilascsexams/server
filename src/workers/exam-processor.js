import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../lib/connectDB.js";
import ExamAttempt from "../models/examAttempt.models.js";
import Exam from "../models/exam.models.js";
import { processBatchQueue } from "../services/redisService.js";
import { processExamSubmission } from "../utils/processExamSubmission.js";

dotenv.config();

// Connect to databases
const startExamProcessor = async () => {
  try {
    await connectDB();
    console.log("[Exam Processor] Connected to database");

    // Start processing exams
    processExams();
  } catch (error) {
    console.error("[Exam Processor] Error starting worker:", error);
    process.exit(1);
  }
};

// Process exam submissions
const processExams = () => {
  setInterval(async () => {
    try {
      const processed = await processExamBatch();
      if (processed > 0) {
        console.log(`[Exam Processor] Processed ${processed} exam submissions`);
      }
    } catch (error) {
      console.error("[Exam Processor] Error processing exams:", error);
    }
  }, 3000); // Process every 3 seconds
};

// Process a batch of exams
const processExamBatch = async () => {
  try {
    return await processBatchQueue("exam_submissions", async (items) => {
      // Process each exam submission
      const processPromises = items.map(async (item) => {
        const { attemptId, userId } = item.data;

        try {
          // Get the attempt with all necessary data
          const attempt = await ExamAttempt.findOne({
            _id: attemptId,
            userId,
            status: "processing", // Only process attempts that are marked as processing
          });

          if (!attempt) {
            console.log(
              `[Exam Processor] Attempt ${attemptId} not found or not in processing state`
            );
            return false;
          }

          // Get the exam
          const exam = await Exam.findById(attempt.examId);
          if (!exam) {
            console.error(
              `[Exam Processor] Exam not found for attempt ${attemptId}`
            );
            return false;
          }

          // Start a session for transaction
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            // Process the exam submission
            const result = await processExamSubmission(
              attemptId,
              attempt,
              exam,
              session
            );

            // Commit the transaction
            await session.commitTransaction();
            session.endSession();

            console.log(
              `[Exam Processor] Successfully processed exam ${attemptId} with score ${result.finalScore}/${exam.totalMarks}`
            );
            return true;
          } catch (error) {
            // Abort transaction on error
            await session.abortTransaction();
            session.endSession();

            console.error(
              `[Exam Processor] Error processing exam ${attemptId}:`,
              error
            );

            // Mark as failed in database
            await ExamAttempt.updateOne(
              { _id: attemptId },
              {
                $set: {
                  status: "error",
                  processingError: error.message,
                },
              }
            );

            return false;
          }
        } catch (error) {
          console.error(
            `[Exam Processor] Error processing attempt ${attemptId}:`,
            error
          );
          return false;
        }
      });

      // Wait for all processing to complete
      const results = await Promise.allSettled(processPromises);

      // Count successful processing
      return results.filter((r) => r.status === "fulfilled" && r.value === true)
        .length;
    });
  } catch (error) {
    console.error("[Exam Processor] Error in processExamBatch:", error);
    return 0;
  }
};

// Handle graceful shutdown
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function gracefulShutdown() {
  console.log("[Exam Processor] Starting graceful shutdown...");

  try {
    await mongoose.connection.close();
    console.log("[Exam Processor] MongoDB connection closed");
    process.exit(0);
  } catch (error) {
    console.error("[Exam Processor] Error during shutdown:", error);
    process.exit(1);
  }
}

// Start the worker
startExamProcessor();
