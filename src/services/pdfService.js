import * as dotenv from "dotenv";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { AppError } from "../utils/errorHandler.js";
import { storage } from "../config/firebase.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

// Load environment variables
dotenv.config();

// Define constants
const PDF_FOLDER = "exam-results"; // Folder name in Firebase Storage
const publicPath = path.join(process.cwd(), "public", "publications");

// Ensure local publications directory exists (for fallback)
if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath, { recursive: true });
}

// Log firebase configuration status
console.log("Firebase Storage configured for PDF uploads");

/**
 * Generate a PDF with exam rankings
 * @param {Object} exam - Exam details
 * @param {Array} rankings - Ranked student data
 * @param {Object} stats - Statistics about the exam results
 * @returns {Promise<{fileName: string, pdfBuffer: Buffer}>}
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

  // Create PDF document
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  // Collect PDF data as buffer for Firebase upload
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  // Create temporary local file (for backup/fallback)
  const filePath = path.join(publicPath, fileName);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Add content to PDF
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

  // Add rankings table
  doc.fontSize(12).font("Helvetica-Bold").text("Student Rankings:");
  doc.moveDown(0.5);

  // Sort and display rankings
  const sortedRankings = [...rankings].sort((a, b) => b.score - a.score);
  sortedRankings.forEach((student, index) => {
    student.rank = index + 1;
  });

  // Table setup
  const startX = 50;
  let startY = doc.y;
  const colWidths = [30, 120, 80, 80, 80, 60];

  // Draw header
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

  // Draw rows
  doc.font("Helvetica").fontSize(10);
  sortedRankings.forEach((student) => {
    // Check for page break
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
  doc.moveDown(4);
  doc
    .fontSize(8)
    .font("Helvetica-Oblique")
    .text(
      "Disclaimer: This report is generated automatically and the results are based on the performance in this exam only.",
      { align: "center" }
    );

  // Finalize PDF
  doc.end();

  // Return the PDF data when stream finishes
  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const pdfBuffer = Buffer.concat(chunks);
      resolve({ fileName, pdfBuffer, filePath });
    });

    stream.on("error", (err) => {
      console.error("Error creating PDF:", err);
      reject(err);
    });
  });
};

/**
 * Upload PDF to Firebase Storage
 * @param {Buffer} pdfBuffer - PDF buffer to upload
 * @param {string} fileName - Name to use for the file
 * @returns {Promise<string>} Direct URL to the uploaded PDF
 */
export const uploadPdfToFirebase = async (pdfBuffer, fileName) => {
  try {
    // Create file reference in Firebase Storage
    const storageRef = ref(storage, `${PDF_FOLDER}/${fileName}`);

    console.log(`Uploading PDF to Firebase Storage: ${PDF_FOLDER}/${fileName}`);

    // Upload the buffer
    const snapshot = await uploadBytes(storageRef, pdfBuffer, {
      contentType: "application/pdf",
    });

    // Get the download URL
    const downloadUrl = await getDownloadURL(storageRef);

    console.log("✅ PDF uploaded successfully to Firebase Storage");
    console.log("📄 Download URL:", downloadUrl);

    return downloadUrl;
  } catch (error) {
    console.error("Error uploading PDF to Firebase:", error);

    // Fall back to local storage if Firebase upload fails
    console.warn("Falling back to local storage for PDF");
    return `/publications/${fileName}`;
  }
};

/**
 * Combined function to generate and upload a PDF
 * @param {Object} exam - Exam details
 * @param {Array} rankings - Ranked student data
 * @param {Object} stats - Statistics about the exam results
 * @returns {Promise<{fileUrl: string, fileName: string}>}
 */
export const generateAndUploadPDF = async (exam, rankings, stats) => {
  try {
    // Generate the PDF first
    console.log("Generating PDF...");
    const { fileName, pdfBuffer } = await generateRankingsPDF(
      exam,
      rankings,
      stats
    );

    // Upload to Firebase Storage
    console.log("Uploading to Firebase Storage...");
    const fileUrl = await uploadPdfToFirebase(pdfBuffer, fileName);

    console.log(`PDF generation and upload complete: ${fileName}`);
    console.log(`URL: ${fileUrl}`);

    // Return both the URL and filename
    return { fileUrl, fileName };
  } catch (error) {
    console.error("Error in generateAndUploadPDF:", error);
    throw new AppError("Failed to generate and upload PDF", 500);
  }
};

/**
 * Delete a file from Firebase Storage
 * @param {string} fileUrl - URL of the file to delete
 * @returns {Promise<boolean>} Success status
 */
export const deleteFile = async (fileUrl) => {
  try {
    // Check if this is a Firebase Storage URL
    if (fileUrl.includes("firebasestorage.googleapis.com")) {
      // Extract the full path by decoding the URL
      const fullPath = decodeURIComponent(
        fileUrl.split("/o/")[1]?.split("?")[0]
      );

      if (fullPath) {
        // Create a reference to the file
        const fileRef = ref(storage, fullPath);

        console.log(`Deleting file from Firebase Storage: ${fullPath}`);

        // Delete the file
        await deleteObject(fileRef);
        console.log("✅ File successfully deleted from Firebase Storage");
        return true;
      }
    }

    // Fall back to local file deletion if needed
    try {
      const fileName = fileUrl.split("/").pop();
      const filePath = path.join(publicPath, fileName);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted local file: ${filePath}`);
      }
      return true;
    } catch (localError) {
      console.error("Error deleting local file:", localError);
      return false;
    }
  } catch (error) {
    console.error("Error deleting file:", error);
    return false;
  }
};

/**
 * Check if a URL is a Firebase Storage URL
 * @param {string} url - URL to check
 * @returns {boolean} - True if it's a Firebase Storage URL
 */
export const isFirebaseUrl = (url) => {
  return (
    url &&
    typeof url === "string" &&
    url.includes("firebasestorage.googleapis.com")
  );
};
