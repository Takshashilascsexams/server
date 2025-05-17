import express from "express";
import path from "path";
import fs from "fs";

/**
 * Configure Express to serve PDF files
 * @param {Object} app - Express app instance
 */
export const configurePdfServer = (app) => {
  const publicationPath = path.join(process.cwd(), "public", "publications");

  // Ensure directory exists
  if (!fs.existsSync(publicationPath)) {
    fs.mkdirSync(publicationPath, { recursive: true });
  }

  // Configure Express to serve PDF files from this directory
  app.use(
    "/publications",
    express.static(publicationPath, {
      // Set correct MIME type for PDFs
      setHeaders: (res, path) => {
        if (path.endsWith(".pdf")) {
          res.setHeader("Content-Type", "application/pdf");
          // Allow PDFs to be displayed in-browser rather than downloaded
          res.setHeader("Content-Disposition", "inline");
        }
      },
    })
  );

  console.log(
    `PDF server configured at /publications serving from ${publicationPath}`
  );

  // Add a diagnostic endpoint in development
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/check-pdf-access", (req, res) => {
      let files = [];
      let directoryExists = false;

      try {
        directoryExists = fs.existsSync(publicationPath);
        if (directoryExists) {
          files = fs.readdirSync(publicationPath);
        }
      } catch (error) {
        console.error("Error accessing PDF directory:", error);
      }

      res.json({
        status: "success",
        pdfDirectory: {
          path: publicationPath,
          exists: directoryExists,
          fileCount: files.length,
          files: files.slice(0, 10), // Show first 10 files
        },
        cloudinaryConfig: {
          configured:
            !!process.env.CLOUDINARY_CLOUD_NAME &&
            !!process.env.CLOUDINARY_API_KEY &&
            !!process.env.CLOUDINARY_API_SECRET,
          cloudName: process.env.CLOUDINARY_CLOUD_NAME || "not_configured",
        },
        sampleUrls: files.slice(0, 3).map((file) => ({
          filename: file,
          localUrl: `/publications/${file}`,
        })),
      });
    });
  }
};
