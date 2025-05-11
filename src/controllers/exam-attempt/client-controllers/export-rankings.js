import ExamAttempt from "../../../models/examAttempt.models.js";
import Exam from "../../../models/exam.models.js";
import User from "../../../models/user.models.js";
import { catchAsync, AppError } from "../../../utils/errorHandler.js";
import { createObjectCsvStringifier } from "csv-writer";

/**
 * Controller to export rankings for a specific exam in CSV format
 */
const exportRankings = catchAsync(async (req, res, next) => {
  const { examId } = req.params;
  const { format = "csv" } = req.query;

  if (!examId) {
    return next(new AppError("Exam ID is required", 400));
  }

  // Check if exam exists
  const exam = await Exam.findById(examId);
  if (!exam) {
    return next(new AppError("Exam not found", 404));
  }

  // Get all completed attempts for this exam
  const attempts = await ExamAttempt.find({
    examId,
    status: "completed",
  })
    .sort({ rank: 1 }) // Sort by rank
    .populate({
      path: "userId",
      select: "fullName email phoneNumber",
    })
    .lean();

  if (attempts.length === 0) {
    return next(new AppError("No completed attempts found for this exam", 404));
  }

  if (format === "csv") {
    // Prepare CSV data
    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: "rank", title: "Rank" },
        { id: "name", title: "Student Name" },
        { id: "email", title: "Email" },
        { id: "phone", title: "Phone" },
        { id: "score", title: "Score" },
        { id: "percentage", title: "Percentage (%)" },
        { id: "correctAnswers", title: "Correct Answers" },
        { id: "wrongAnswers", title: "Wrong Answers" },
        { id: "unattempted", title: "Unattempted" },
        { id: "timeTaken", title: "Time Taken (seconds)" },
        { id: "percentile", title: "Percentile" },
        { id: "attemptedOn", title: "Attempted On" },
      ],
    });

    // Format the data for CSV
    const records = attempts.map((attempt) => {
      return {
        rank: attempt.rank || "N/A",
        name: attempt.userId?.fullName || "Anonymous",
        email: attempt.userId?.email || "N/A",
        phone: attempt.userId?.phoneNumber || "N/A",
        score: `${attempt.finalScore}/${exam.totalMarks}`,
        percentage: ((attempt.finalScore / exam.totalMarks) * 100).toFixed(2),
        correctAnswers: attempt.correctAnswers,
        wrongAnswers: attempt.wrongAnswers,
        unattempted: attempt.unattempted,
        timeTaken: attempt.endTime
          ? Math.floor(
              (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
            )
          : exam.duration * 60,
        percentile: attempt.percentile?.toFixed(2) || "N/A",
        attemptedOn: new Date(attempt.createdAt).toISOString().split("T")[0],
      };
    });

    // Generate CSV
    const csvData =
      csvStringifier.getHeaderString() +
      csvStringifier.stringifyRecords(records);

    // Set headers for download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exam.title.replace(/\s+/g, "_")}_Rankings.csv"`
    );

    // Send the CSV data
    return res.status(200).send(csvData);
  } else if (format === "json") {
    // Format the data for JSON
    const records = attempts.map((attempt) => {
      return {
        rank: attempt.rank || null,
        student: {
          id: attempt.userId?._id || null,
          name: attempt.userId?.fullName || "Anonymous",
          email: attempt.userId?.email || null,
          phone: attempt.userId?.phoneNumber || null,
        },
        score: {
          marks: attempt.finalScore,
          totalMarks: exam.totalMarks,
          percentage: ((attempt.finalScore / exam.totalMarks) * 100).toFixed(2),
        },
        performance: {
          correctAnswers: attempt.correctAnswers,
          wrongAnswers: attempt.wrongAnswers,
          unattempted: attempt.unattempted,
          negativeMarks: attempt.negativeMarks || 0,
        },
        timeTaken: attempt.endTime
          ? Math.floor(
              (new Date(attempt.endTime) - new Date(attempt.startTime)) / 1000
            )
          : exam.duration * 60,
        percentile: attempt.percentile || null,
        attemptId: attempt._id,
        attemptedOn: attempt.createdAt,
      };
    });

    return res.status(200).json({
      status: "success",
      data: {
        exam: {
          id: exam._id,
          title: exam.title,
          description: exam.description,
          totalMarks: exam.totalMarks,
          totalQuestions: exam.totalQuestions,
          duration: exam.duration,
          category: exam.category,
        },
        totalAttempts: attempts.length,
        rankings: records,
      },
    });
  } else {
    return next(
      new AppError("Unsupported export format. Use 'csv' or 'json'", 400)
    );
  }
});

export default exportRankings;
