import mongoose from "mongoose";
import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import Question from "../../../models/questions.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { getUserId } from "../../../utils/cachedDbQueries.js";
import {
  examService,
  attemptService,
  analyticsService,
  publicationService,
} from "../../../services/redisService.js";

/**
 * Controller to change exam attempt status from "in-progress" to "completed"
 * Only allows status change for in-progress attempts
 */
const changeAttemptStatus = catchAsync(async (req, res, next) => {
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

  // Use a unique lock key to prevent concurrent status changes
  const lockKey = `lock:status:${attemptId}`;
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
          "Another status change is in progress for this attempt. Please try again in a few seconds.",
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

      // Find the exam attempt - ensure primary read and validate current status
      const attempt = await ExamAttempt.findOne({
        _id: attemptId,
        status: "in-progress", // Only allow changing in-progress attempts
      })
        .session(session)
        .read("primary");

      if (!attempt) {
        await session.abortTransaction();
        session.endSession();
        await examService.examCache.del(lockKey);
        return next(
          new AppError(
            "Exam attempt not found or not in 'in-progress' status",
            404
          )
        );
      }

      // Get the exam details
      const exam = await Exam.findById(attempt.examId)
        .session(session)
        .read("primary");

      if (!exam) {
        await session.abortTransaction();
        session.endSession();
        await examService.examCache.del(lockKey);
        return next(new AppError("Associated exam not found", 404));
      }

      // Store original values for comparison
      const originalData = {
        status: attempt.status,
        endTime: attempt.endTime,
        timeRemaining: attempt.timeRemaining,
      };

      // Calculate the current time and time spent
      const currentTime = new Date();
      const timeSpent = Math.floor(
        (currentTime - new Date(attempt.startTime)) / 1000
      );

      // Prepare the status change data
      const statusChangeData = {
        status: "completed",
        endTime: currentTime,
        timeRemaining: 0,
        // Add audit fields
        statusChangedBy: adminUserId,
        statusChangedAt: currentTime,
        manuallyCompleted: true, // Flag to indicate this was manually completed by admin
      };

      // If the attempt doesn't have calculated results yet, we should calculate them
      // This happens when an attempt was in-progress and never submitted
      if (
        !attempt.finalScore &&
        attempt.answers &&
        attempt.answers.length > 0
      ) {
        // Get question IDs from attempt
        const questionIds = attempt.answers.map((a) => a.questionId.toString());

        if (questionIds.length > 0) {
          // Fetch questions from database
          const questions = await Question.find({ _id: { $in: questionIds } })
            .select(
              "_id options type marks hasNegativeMarking negativeMarks correctAnswer"
            )
            .lean()
            .session(session)
            .read("primary");

          // Build question map for quick lookup
          const questionMap = questions.reduce((map, q) => {
            map[q._id.toString()] = q;
            return map;
          }, {});

          // Calculate results
          let totalMarks = 0;
          let totalNegativeMarks = 0;
          let correctAnswers = 0;
          let wrongAnswers = 0;
          let unattempted = 0;

          // Evaluate each answer
          const evaluatedAnswers = attempt.answers.map((answer) => {
            const questionId = answer.questionId.toString();
            const question = questionMap[questionId];

            // Basic answer structure
            const evaluatedAnswer = {
              questionId: answer.questionId,
              selectedOption: answer.selectedOption,
              isCorrect: null,
              marksEarned: 0,
              negativeMarks: 0,
              responseTime: answer.responseTime || 0,
            };

            // Skip if question not found
            if (!question) {
              unattempted++;
              return evaluatedAnswer;
            }

            // Skip if no answer selected
            if (
              answer.selectedOption === null ||
              answer.selectedOption === undefined
            ) {
              unattempted++;
              return evaluatedAnswer;
            }

            // Evaluate answer based on question type
            let isCorrect = false;

            if (
              question.type === "MCQ" ||
              question.type === "STATEMENT_BASED"
            ) {
              // Find correct option by matching with the correctAnswer text
              const correctOption = question.options.find(
                (o) => o.optionText === question.correctAnswer
              );

              if (correctOption) {
                isCorrect =
                  answer.selectedOption.toString() ===
                  correctOption._id.toString();
              }
            } else if (question.type === "MULTIPLE_SELECT") {
              // For multiple select, use the isCorrect flag on options
              if (Array.isArray(answer.selectedOption)) {
                const correctOptions = question.options
                  .filter((o) => o.isCorrect)
                  .map((o) => o._id.toString());

                isCorrect =
                  correctOptions.length === answer.selectedOption.length &&
                  correctOptions.every((id) =>
                    answer.selectedOption.includes(id)
                  );
              }
            } else if (question.type === "TRUE_FALSE") {
              // For true/false, find option matching correctAnswer text
              const correctOption = question.options.find(
                (o) =>
                  o.optionText.toLowerCase() ===
                  question.correctAnswer.toLowerCase()
              );

              if (correctOption) {
                isCorrect =
                  answer.selectedOption.toString() ===
                  correctOption._id.toString();
              }
            }

            // Update evaluated answer
            evaluatedAnswer.isCorrect = isCorrect;

            if (isCorrect) {
              evaluatedAnswer.marksEarned = question.marks || 1;
              totalMarks += evaluatedAnswer.marksEarned;
              correctAnswers++;
            } else {
              // Apply negative marking if enabled
              if (exam.hasNegativeMarking && question.hasNegativeMarking) {
                const negMarks =
                  question.negativeMarks || exam.negativeMarkingValue || 0;
                evaluatedAnswer.negativeMarks = negMarks;
                totalNegativeMarks += negMarks;
              }
              wrongAnswers++;
            }

            return evaluatedAnswer;
          });

          // Calculate final score
          const finalScore = Math.max(0, totalMarks - totalNegativeMarks);

          // Determine if passed
          const passMark = (exam.totalMarks * exam.passMarkPercentage) / 100;
          const hasPassed = finalScore >= passMark;

          // Add calculated results to status change data
          statusChangeData.totalMarks = totalMarks;
          statusChangeData.negativeMarks = totalNegativeMarks;
          statusChangeData.finalScore = finalScore;
          statusChangeData.correctAnswers = correctAnswers;
          statusChangeData.wrongAnswers = wrongAnswers;
          statusChangeData.unattempted = unattempted;
          statusChangeData.hasPassed = hasPassed;
          statusChangeData.answers = evaluatedAnswers;
        }
      }

      // Update the attempt in database
      const updatedAttempt = await ExamAttempt.findOneAndUpdate(
        { _id: attemptId },
        { $set: statusChangeData },
        {
          new: true,
          session,
        }
      );

      // Commit transaction
      await session.commitTransaction();
      session.endSession();

      // Clear relevant caches after successful status change
      try {
        const userIdString = attempt.userId.toString();
        const examIdString = exam._id.toString();

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
        ]);

        console.log(
          `🧹 [StatusChange] Cleared caches for user ${userIdString} and exam ${examIdString} after status change`
        );
      } catch (cacheError) {
        console.warn(
          "Non-critical error clearing caches after status change:",
          cacheError
        );
      }

      // Update analytics if results changed significantly
      if (statusChangeData.hasPassed !== undefined) {
        try {
          await analyticsService.queueAnalyticsUpdate(exam._id.toString(), {
            statusChanged: true,
            completed: true,
            passed: statusChangeData.hasPassed,
            failed: !statusChangeData.hasPassed,
            score: statusChangeData.finalScore,
          });
        } catch (analyticsError) {
          console.warn(
            "Non-critical error updating analytics after status change:",
            analyticsError
          );
        }
      }

      // Release lock
      await examService.examCache.del(lockKey);

      // Prepare response with comparison data
      const responseData = {
        attemptId,
        examId: exam._id,
        examTitle: exam.title,
        statusChangedAt: currentTime,
        statusChangedBy: adminUserId,
        originalStatus: originalData.status,
        newStatus: "completed",
        userId: attempt.userId,
        changes: {
          statusChanged: originalData.status !== "completed",
          endTimeSet: !originalData.endTime,
          timeRemainingCleared: originalData.timeRemaining > 0,
          resultsCalculated: !!statusChangeData.finalScore,
        },
        // Include calculated results if they were computed
        ...(statusChangeData.finalScore !== undefined && {
          calculatedResults: {
            totalMarks: statusChangeData.totalMarks,
            negativeMarks: statusChangeData.negativeMarks,
            finalScore: statusChangeData.finalScore,
            correctAnswers: statusChangeData.correctAnswers,
            wrongAnswers: statusChangeData.wrongAnswers,
            unattempted: statusChangeData.unattempted,
            hasPassed: statusChangeData.hasPassed,
            scorePercentage: (
              (statusChangeData.finalScore / exam.totalMarks) *
              100
            ).toFixed(2),
          },
        }),
      };

      return res.status(200).json({
        status: "success",
        message: "Exam attempt status changed successfully",
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

    console.error("Error in exam attempt status change:", error);

    // Provide specific error messages for common issues
    if (error.name === "ValidationError") {
      return next(new AppError("Invalid data provided for status change", 400));
    }

    if (error.name === "CastError") {
      return next(new AppError("Invalid ID format provided", 400));
    }

    if (error.name === "MongoTransactionError") {
      return next(
        new AppError("Database transaction failed. Please try again.", 500)
      );
    }

    return next(new AppError("Failed to change exam attempt status", 500));
  }
});

export default changeAttemptStatus;
