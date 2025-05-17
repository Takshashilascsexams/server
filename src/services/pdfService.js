import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { AppError } from "../utils/errorHandler.js";
import cloudinary from "cloudinary";
import streamifier from "streamifier";

// Configure storage options
const isProduction = process.env.NODE_ENV === "production";
const publicPath = path.join(process.cwd(), "public", "publications");

// Ensure publications directory exists for development mode
if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath, { recursive: true });
}

// Track if Cloudinary is properly configured
let isCloudinaryConfigured = false;

// Configure Cloudinary
try {
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    isCloudinaryConfigured = true;
    console.log("Cloudinary configured successfully");
  } else {
    console.warn(
      "⚠️ Cloudinary environment variables missing. PDF uploads will use local storage only."
    );
    console.warn(
      "Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file."
    );
  }
} catch (error) {
  console.error("Error configuring Cloudinary:", error);
}

/**
 * Generate a PDF with exam rankings
 * @param {Object} exam - Exam details
 * @param {Array} rankings - Ranked student data
 * @param {Object} stats - Statistics about the exam results
 * @returns {Promise<{filePath: string, fileName: string, pdfBuffer: Buffer}>}
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
  const filePath = path.join(publicPath, fileName);

  // Create PDF document
  const doc = new PDFDocument({
    margin: 50,
    size: "A4",
  });

  // Collect PDF data as a buffer for direct Cloudinary upload in production
  const chunks = [];
  doc.on("data", (chunk) => {
    chunks.push(chunk);
  });

  // Create write stream for local storage
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

  // Sort rankings by score in descending order to ensure highest scorers are at the top
  const sortedRankings = [...rankings].sort((a, b) => b.score - a.score);

  // Update the rankings sequentially after sorting
  sortedRankings.forEach((student, index) => {
    student.rank = index + 1;
  });

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
  sortedRankings.forEach((student, index) => {
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

  // Add footer with increased space before the disclaimer
  doc.moveDown(4);
  doc
    .fontSize(8)
    .font("Helvetica-Oblique")
    .text(
      "Disclaimer: This report is generated automatically and the results are based on the performance in this exam only.",
      {
        align: "center",
      }
    );

  // Finalize the PDF
  doc.end();

  // Return a promise that resolves when the PDF is finalized
  return new Promise((resolve, reject) => {
    // Set up for stream completion
    stream.on("finish", () => {
      const pdfBuffer = Buffer.concat(chunks);
      resolve({ filePath, fileName, pdfBuffer });
    });

    stream.on("error", (err) => {
      console.error("Error writing PDF to file:", err);
      // Even if local file fails, we might still have the buffer
      if (chunks.length > 0) {
        const pdfBuffer = Buffer.concat(chunks);
        resolve({ filePath: null, fileName, pdfBuffer });
      } else {
        reject(err);
      }
    });

    doc.on("error", reject);
  });
};

/**
 * Upload a file to Cloudinary or store locally
 * @param {string|Buffer} filePathOrBuffer - Local file path or buffer
 * @param {string} fileName - File name to use in storage
 * @returns {Promise<string>} - URL of the uploaded file
 */
export const uploadFile = async (filePathOrBuffer, fileName) => {
  try {
    // If Cloudinary is properly configured and we're in production, use it
    if (isCloudinaryConfigured && isProduction) {
      const publicId = `exam-results/${fileName.replace(/\.pdf$/, "")}`;

      // Upload the file to Cloudinary
      if (Buffer.isBuffer(filePathOrBuffer)) {
        // Upload buffer to Cloudinary
        const uploadResult = await uploadBufferToCloudinary(
          filePathOrBuffer,
          publicId
        );
        return uploadResult.secure_url;
      } else {
        // Upload from file path
        const uploadResult = await cloudinary.uploader.upload(
          filePathOrBuffer,
          {
            resource_type: "raw",
            public_id: publicId,
            format: "pdf",
            type: "upload",
            access_mode: "public",
          }
        );

        // Success! Now we can optionally clean up the local file
        if (filePathOrBuffer && fs.existsSync(filePathOrBuffer)) {
          fs.unlinkSync(filePathOrBuffer);
        }

        return uploadResult.secure_url;
      }
    } else {
      // Not in production or Cloudinary not configured - use local storage
      // If we're passed a buffer, write it to disk
      if (Buffer.isBuffer(filePathOrBuffer)) {
        const filePath = path.join(publicPath, fileName);
        fs.writeFileSync(filePath, filePathOrBuffer);
      } else if (
        filePathOrBuffer &&
        path.dirname(filePathOrBuffer) !== publicPath
      ) {
        // If the file is not already in the publications directory, copy it there
        const destPath = path.join(publicPath, fileName);
        fs.copyFileSync(filePathOrBuffer, destPath);
        // Remove the original file
        fs.unlinkSync(filePathOrBuffer);
      }

      // Return local URL
      console.log(`PDF stored locally at: /publications/${fileName}`);
      return `/publications/${fileName}`;
    }
  } catch (error) {
    console.error("Error uploading file:", error);

    // Fallback to local storage if Cloudinary fails
    try {
      console.warn("Falling back to local storage");

      // Ensure the file exists locally
      let localPath = filePathOrBuffer;
      if (Buffer.isBuffer(filePathOrBuffer)) {
        localPath = path.join(publicPath, fileName);
        fs.writeFileSync(localPath, filePathOrBuffer);
      } else if (!fs.existsSync(path.join(publicPath, fileName))) {
        // If the file doesn't exist in publications dir, copy it there
        const destPath = path.join(publicPath, fileName);
        fs.copyFileSync(filePathOrBuffer, destPath);
      }

      return `/publications/${fileName}`;
    } catch (fallbackError) {
      console.error("Fallback to local storage also failed:", fallbackError);
      throw new AppError("Failed to store PDF", 500);
    }
  }
};

/**
 * Helper function to upload a buffer to Cloudinary
 * @param {Buffer} buffer - PDF buffer
 * @param {string} publicId - Public ID for the file in Cloudinary
 * @returns {Promise<Object>} - Cloudinary upload result
 */
const uploadBufferToCloudinary = (buffer, publicId) => {
  return new Promise((resolve, reject) => {
    if (!isCloudinaryConfigured) {
      return reject(new Error("Cloudinary is not properly configured"));
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: publicId,
        format: "pdf",
        type: "upload",
        access_mode: "public",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

/**
 * Generate a signed URL for Cloudinary assets
 * @param {string} fileUrl - Cloudinary URL or file path
 * @param {number} expiresIn - Expiration time in seconds
 * @returns {Promise<string>} - Signed URL
 */
export const generateSignedUrl = async (fileUrl, expiresIn = 86400) => {
  try {
    // Skip if not a Cloudinary URL or Cloudinary not configured
    if (!isCloudinaryConfigured || !isCloudinaryUrl(fileUrl)) {
      return fileUrl;
    }

    // Extract public ID from Cloudinary URL
    const urlParts = fileUrl.split("/");
    const filename = urlParts[urlParts.length - 1];
    if (!filename) {
      console.error("Could not extract filename from URL:", fileUrl);
      return fileUrl;
    }

    const publicId = `exam-results/${filename.replace(/\.pdf$/, "")}`;

    // Generate a signed URL with expiration
    const signedUrl = cloudinary.utils.private_download_url(publicId, "pdf", {
      resource_type: "raw",
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    });

    return signedUrl;
  } catch (error) {
    console.error("Error generating signed URL:", error);
    // Return original URL as fallback
    return fileUrl;
  }
};

/**
 * Delete a file from storage
 * @param {string} fileUrl - URL of the file to delete
 * @returns {Promise<boolean>} - Success status
 */
export const deleteFile = async (fileUrl) => {
  try {
    if (isCloudinaryConfigured && isCloudinaryUrl(fileUrl)) {
      // Extract the public_id from the URL
      const urlParts = fileUrl.split("/");
      const filename = urlParts[urlParts.length - 1];
      const publicId = `exam-results/${filename.replace(/\.pdf$/, "")}`;

      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: "raw",
      });

      if (result.result !== "ok") {
        console.warn(`Cloudinary deletion result: ${result.result}`);
      }
    }

    // Also try to remove local file if it exists
    try {
      const filename = fileUrl.split("/").pop();
      const filePath = path.join(publicPath, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (localError) {
      console.error("Error deleting local file:", localError);
      // Continue even if local file deletion fails
    }

    return true;
  } catch (error) {
    console.error("Error deleting file:", error);
    return false;
  }
};

/**
 * Combined function to generate and directly upload a PDF
 * @param {Object} exam - Exam details
 * @param {Array} rankings - Ranked student data
 * @param {Object} stats - Statistics about the exam results
 * @returns {Promise<{fileUrl: string, fileName: string}>} - URL and name of the uploaded PDF
 */
export const generateAndUploadPDF = async (exam, rankings, stats) => {
  try {
    // Generate the PDF
    const { filePath, fileName, pdfBuffer } = await generateRankingsPDF(
      exam,
      rankings,
      stats
    );

    // Upload the PDF (either from filePath or directly from buffer)
    const fileUrl = await uploadFile(filePath || pdfBuffer, fileName);

    return { fileUrl, fileName };
  } catch (error) {
    console.error("Error in generateAndUploadPDF:", error);
    throw new AppError("Failed to generate and upload PDF", 500);
  }
};

/**
 * Check if a URL is a Cloudinary URL
 * @param {string} url - URL to check
 * @returns {boolean} - True if it's a Cloudinary URL
 */
export const isCloudinaryUrl = (url) => {
  return url && typeof url === "string" && url.includes("cloudinary.com");
};

/**
 * Get public ID from Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string} - Public ID
 */
export const getPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;

  const urlParts = url.split("/");
  const filename = urlParts[urlParts.length - 1];
  return `exam-results/${filename.replace(/\.pdf$/, "")}`;
};
