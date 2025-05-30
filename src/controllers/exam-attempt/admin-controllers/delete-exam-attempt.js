import mongoose from "mongoose";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  examService,
  attemptService,
  analyticsService,
  publicationService,
} from "../../../services/redisService.js";

/**
 * Controller to delete an exam attempt
 * Admin-only operation with proper audit trail and cleanup
 */
const deleteExamAttempt = catchAsync(async (req, res, next) => {
  const { attemptId } = req.params;

  // Validate required fields
  if (!attemptId) {
    return next(new AppError("Attempt ID is required", 400));
  }

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(attemptId)) {
    return next(new AppError("Invalid attempt ID format", 400));
  }

  // Get admin user ID from token for audit purposes
  const adminUserId = await getUserId(req.user.sub);
  if (!adminUserId) {
    return next(new AppError("Admin user not found", 404));
  }

  // Use a unique lock key to prevent concurrent deletions
  const lockKey = `lock:delete:${attemptId}`;
  let lockAcquired = false;

  try {
    // Try to acquire lock with exponential backoff (3 attempts)
    for (let attempt = 1; attempt <= 3 && !lockAcquired; attempt++) {
      try {
        // Set lock with 30 second expiry to prevent deadlocks
        lockAcquired = await examService.examCache.set(
          lockKey,
          Date.now(),
          "NX",
          "EX",
          30
        );

        if (!lockAcquired && attempt < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * Math.pow(2, attempt - 1))
          );
        }
      } catch (error) {
        console.error(`Error acquiring lock (attempt ${attempt}/3):`, error);
      }
    }

    if (!lockAcquired) {
      return next(
        new AppError(
          "Another deletion is in progress for this attempt. Please try again in a few seconds.",
          429
        )
      );
    }

    // Start database transaction with proper settings
    const session = await mongoose.startSession();

    try {
      await session.startTransaction({
        readPreference: "primary",
        readConcern: { level: "majority" },
        writeConcern: { w: "majority" },
      });

      // Find the exam attempt - ensure primary read
      const attempt = await ExamAttempt.findById(attemptId)
        .populate({
          path: "userId",
          select: "fullName email",
        })
        .populate({
          path: "examId",
          select: "title",
        })
        .session(session)
        .read("primary");

      if (!attempt) {
        await session.abortTransaction();
        session.endSession();
        await examService.examCache.del(lockKey);
        return next(new AppError("Exam attempt not found", 404));
      }

      // Store attempt data for response and cleanup
      const attemptData = {
        id: attempt._id,
        studentId: attempt.userId._id,
        studentName: attempt.userId.fullName || "Anonymous User",
        studentEmail: attempt.userId.email || "N/A",
        examId: attempt.examId._id,
        examTitle: attempt.examId.title,
        status: attempt.status,
        startTime: attempt.startTime,
        endTime: attempt.endTime,
        finalScore: attempt.finalScore,
        hasPassed: attempt.hasPassed,
        deletedBy: adminUserId,
        deletedAt: new Date(),
      };

      // Check if attempt is currently in progress
      const isInProgress = attempt.status === "in-progress";

      // Delete the exam attempt
      await ExamAttempt.findByIdAndDelete(attemptId).session(session);

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      // Clear relevant caches after successful deletion
      try {
        const userIdString = attempt.userId._id.toString();
        const examIdString = attempt.examId._id.toString();

        // Clear multiple cache types for comprehensive cleanup
        await Promise.allSettled([
          // User-specific exam caches
          examService.clearUserSpecificExamsCache(userIdString),
          examService.clearLatestExamsCache(),

          // Attempt-specific caches
          attemptService.deleteAttempt(attemptId),
          attemptService.clearUserAttempts(userIdString),

          // User exam attempts cache (from publicationService)
          publicationService.clearUserExamAttempts(userIdString),

          // Admin exam results cache pattern clearance
          examService.clearPattern(
            examService.examCache,
            `admin:exam:results:${examIdString}:*`
          ),

          // Clear any timer data for in-progress attempts
          ...(isInProgress
            ? [
                examService.del(examService.examCache, `timer:${attemptId}`),
                examService.del(
                  examService.examCache,
                  `attempt:${userIdString}:${examIdString}:active`
                ),
              ]
            : []),
        ]);

        console.log(
          `🗑️ [DeleteAttempt] Cleared caches for user ${userIdString} and exam ${examIdString} after deletion`
        );
      } catch (cacheError) {
        console.warn(
          "Non-critical error clearing caches after deletion:",
          cacheError
        );
      }

      // Update analytics to reflect the deletion
      try {
        const analyticsUpdate = {
          deleted: true,
          attemptDeleted: true,
        };

        // If it was a completed attempt, adjust completion stats
        if (attempt.status === "completed") {
          analyticsUpdate.completedDeleted = true;
          analyticsUpdate.totalCompleted = -1; // Decrement

          if (attempt.hasPassed) {
            analyticsUpdate.passCount = -1; // Decrement
          } else {
            analyticsUpdate.failCount = -1; // Decrement
          }
        }

        // If it was in progress, adjust attempt stats
        if (attempt.status === "in-progress") {
          analyticsUpdate.totalAttempted = -1; // Decrement
        }

        await analyticsService.queueAnalyticsUpdate(
          attempt.examId._id.toString(),
          analyticsUpdate
        );
      } catch (analyticsError) {
        console.warn(
          "Non-critical error updating analytics after deletion:",
          analyticsError
        );
      }

      // Release lock
      await examService.examCache.del(lockKey);

      // Log the deletion for audit purposes
      console.log(
        `🗑️ [AUDIT] Admin ${adminUserId} deleted exam attempt ${attemptId} for user ${attemptData.studentName} (${attemptData.studentEmail}) in exam "${attemptData.examTitle}"`
      );

      // Prepare response
      const responseData = {
        deletedAttempt: {
          attemptId: attemptData.id,
          studentId: attemptData.studentId,
          studentName: attemptData.studentName,
          studentEmail: attemptData.studentEmail,
          examId: attemptData.examId,
          examTitle: attemptData.examTitle,
          status: attemptData.status,
          finalScore: attemptData.finalScore,
          hasPassed: attemptData.hasPassed,
        },
        deletionInfo: {
          deletedBy: adminUserId,
          deletedAt: attemptData.deletedAt,
          wasInProgress: isInProgress,
          hadResults: !!attempt.finalScore,
        },
        cleanup: {
          cachesCleared: true,
          analyticsUpdated: true,
          timersCleared: isInProgress,
        },
      };

      return res.status(200).json({
        status: "success",
        message: "Exam attempt deleted successfully",
        data: responseData,
      });
    } catch (error) {
      // Rollback transaction on any error
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      throw error;
    }
  } catch (error) {
    // Release lock if any error occurred
    if (lockAcquired) {
      await examService.examCache.del(lockKey);
    }

    console.error("Error in exam attempt deletion:", error);

    // Provide specific error messages for common issues
    if (error.name === "ValidationError") {
      return next(new AppError("Invalid data provided for deletion", 400));
    }

    if (error.name === "CastError") {
      return next(new AppError("Invalid ID format provided", 400));
    }

    if (error.name === "MongoTransactionError") {
      return next(
        new AppError("Database transaction failed. Please try again.", 500)
      );
    }

    return next(new AppError("Failed to delete exam attempt", 500));
  }
});

export default deleteExamAttempt;
