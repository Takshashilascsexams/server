import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "../utils/errorHandler.js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Configure storage options
const isProduction = process.env.NODE_ENV === "production";
const uploadDir = path.join(process.cwd(), "uploads", "publications");

// Ensure uploads directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Initialize S3 client for production
let s3Client;
if (isProduction) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Generate a PDF with exam rankings
 * @param {Object} exam - Exam details
 * @param {Array} rankings - Ranked student data
 * @param {Object} stats - Statistics about the exam results
 * @returns {Promise<{filePath: string, fileName: string}>}
 */
export const generateRankingsPDF = async (exam, rankings, stats) => {
  if (!exam || !rankings || rankings.length === 0) {
    throw new AppError("Invalid data for PDF generation", 400);
  }

  // Create a unique file name
  const timestamp = Date.now();
  const fileName = `${exam.title.replace(
    /\s+/g,
    "-"
  )}-results-${timestamp}.pdf`;
  const filePath = path.join(uploadDir, fileName);

  // Create PDF document
  const doc = new PDFDocument({
    margin: 50,
    size: "A4",
  });

  // Pipe the PDF to a file
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Add header with exam title and details
  doc.fontSize(18).font("Helvetica-Bold").text(exam.title, { align: "center" });
  doc.moveDown(0.5);
  doc
    .fontSize(14)
    .font("Helvetica")
    .text("Results & Rankings", { align: "center" });
  doc.moveDown(1);

  // Add exam details
  doc.fontSize(12).font("Helvetica-Bold").text("Exam Details:");
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`Duration: ${exam.duration} minutes`)
    .text(`Total Questions: ${exam.totalQuestions}`)
    .text(`Total Marks: ${exam.totalMarks}`)
    .text(`Pass Mark: ${exam.passMarkPercentage}%`)
    .text(`Date Generated: ${new Date().toLocaleString()}`);
  doc.moveDown(1);

  // Add statistics
  doc.fontSize(12).font("Helvetica-Bold").text("Statistics:");
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`Total Attempts: ${stats.totalAttempts}`)
    .text(`Pass Rate: ${stats.passRate}%`)
    .text(`Average Score: ${stats.averageScore}`)
    .text(`Highest Score: ${stats.highestScore}`);
  doc.moveDown(1);

  // Add rankings table header
  doc.fontSize(12).font("Helvetica-Bold").text("Student Rankings:");
  doc.moveDown(0.5);

  // Set initial positions for table
  const startX = 50;
  let startY = doc.y;
  const colWidths = [30, 120, 80, 80, 80, 60];

  // Draw table header
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Rank", startX, startY);
  doc.text("Name", startX + colWidths[0], startY);
  doc.text("Score", startX + colWidths[0] + colWidths[1], startY);
  doc.text(
    "Percentage",
    startX + colWidths[0] + colWidths[1] + colWidths[2],
    startY
  );
  doc.text(
    "Time Taken",
    startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
    startY
  );
  doc.text(
    "Status",
    startX +
      colWidths[0] +
      colWidths[1] +
      colWidths[2] +
      colWidths[3] +
      colWidths[4],
    startY
  );

  startY += 20;
  doc
    .moveTo(startX, startY - 10)
    .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), startY - 10)
    .stroke();

  // Draw table rows
  doc.font("Helvetica").fontSize(10);
  rankings.forEach((student, index) => {
    // Check if we need a new page
    if (startY > 750) {
      doc.addPage();
      startY = 50;
      // Redraw header on new page
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Rank", startX, startY);
      doc.text("Name", startX + colWidths[0], startY);
      doc.text("Score", startX + colWidths[0] + colWidths[1], startY);
      doc.text(
        "Percentage",
        startX + colWidths[0] + colWidths[1] + colWidths[2],
        startY
      );
      doc.text(
        "Time Taken",
        startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
        startY
      );
      doc.text(
        "Status",
        startX +
          colWidths[0] +
          colWidths[1] +
          colWidths[2] +
          colWidths[3] +
          colWidths[4],
        startY
      );
      startY += 20;
      doc
        .moveTo(startX, startY - 10)
        .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), startY - 10)
        .stroke();
      doc.font("Helvetica").fontSize(10);
    }

    const scoreText = `${student.score}/${exam.totalMarks}`;
    const percentageText = `${student.percentage.toFixed(2)}%`;
    const statusText = student.hasPassed ? "PASS" : "FAIL";

    doc.text(student.rank.toString(), startX, startY);
    doc.text(student.user?.name || "Anonymous", startX + colWidths[0], startY, {
      width: colWidths[1],
      ellipsis: true,
    });
    doc.text(scoreText, startX + colWidths[0] + colWidths[1], startY);
    doc.text(
      percentageText,
      startX + colWidths[0] + colWidths[1] + colWidths[2],
      startY
    );
    doc.text(
      student.timeTaken,
      startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
      startY
    );
    doc.text(
      statusText,
      startX +
        colWidths[0] +
        colWidths[1] +
        colWidths[2] +
        colWidths[3] +
        colWidths[4],
      startY
    );

    startY += 20;
  });

  // Add footer
  doc
    .fontSize(8)
    .font("Helvetica-Oblique")
    .text(
      "Disclaimer: This report is generated automatically and the results are based on the performance in this exam only.",
      {
        align: "center",
        bottom: 30,
      }
    );

  // Finalize the PDF
  doc.end();

  // Return a promise that resolves when the PDF is written
  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      resolve({ filePath, fileName });
    });
    stream.on("error", reject);
  });
};

/**
 * Upload a file to storage (S3 in production, local in development)
 * @param {string} filePath - Local file path
 * @param {string} fileName - File name to use in storage
 * @returns {Promise<string>} - URL of the uploaded file
 */
export const uploadFile = async (filePath, fileName) => {
  if (isProduction) {
    // Use S3 in production
    const fileContent = fs.readFileSync(filePath);
    const bucketName = process.env.AWS_S3_BUCKET;
    const key = `publications/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileContent,
      ContentType: "application/pdf",
      ACL: "private",
    });

    try {
      await s3Client.send(command);

      // Generate signed URL
      const url = await generateSignedUrl(key);

      // Clean up local file
      fs.unlinkSync(filePath);

      return url;
    } catch (error) {
      console.error("Error uploading to S3:", error);
      throw new AppError("Failed to upload file to storage", 500);
    }
  } else {
    // In development, use local path
    return `/uploads/publications/${fileName}`;
  }
};

/**
 * Generate a signed URL for S3 objects
 * @param {string} key - S3 object key
 * @param {number} expiresIn - Expiration time in seconds
 * @returns {Promise<string>} - Signed URL
 */
export const generateSignedUrl = async (key, expiresIn = 86400) => {
  if (!isProduction) {
    // In development, return a local path
    return `/uploads/publications/${path.basename(key)}`;
  }

  const bucketName = process.env.AWS_S3_BUCKET;
  // CORRECTION: Use GetObjectCommand instead of PutObjectCommand
  const command = new GetObjectCommand({
    // Changed from PutObjectCommand
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Delete a file from storage
 * @param {string} fileUrl - URL or path of the file to delete
 * @returns {Promise<boolean>} - Success status
 */
export const deleteFile = async (fileUrl) => {
  if (isProduction) {
    // Extract key from URL
    const key = fileUrl.split("/").slice(-2).join("/");
    const bucketName = process.env.AWS_S3_BUCKET;

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    try {
      await s3Client.send(command);
      return true;
    } catch (error) {
      console.error("Error deleting from S3:", error);
      return false;
    }
  } else {
    // In development, remove local file
    try {
      const filePath = path.join(process.cwd(), fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (error) {
      console.error("Error deleting local file:", error);
      return false;
    }
  }
};
