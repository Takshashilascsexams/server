// libraries
import * as dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import hpp from "hpp";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";

// middlewares utilities functions
import compressResponse from "./utils/compressResponse.js";
import { AppError, errorController } from "./utils/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiterMiddleware.js"; // Import the general API rate limiter

// services
import { checkHealth } from "./services/redisService.js";

// routes
import examRoute from "./routes/exam.routes.js";
import questionsRoute from "./routes/question.routes.js";
import paymentRoute from "./routes/payment.routes.js";
import bundleExamRoute from "./routes/bundle-exam.routes.js";
import examAttemptRoute from "./routes/exam-attempt.routes.js";

dotenv.config();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Uncaught exception handler
process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! 💥 Shutting down...");
  console.log(err.name, err.message);
  process.exit(1);
});

// Unhandled promise rejection handler
process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! 💥 Shutting down...");
  console.log(err.name, err.message);
  process.exit(1);
});

const app = express();

// 1) GLOBAL MIDDLEWARES
// Cors
const corsOptions = {
  origin: process.env.CLIENT || "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Response compression middleware
app.use(compressResponse);

// Set security HTTP headers
app.use(helmet());

// Development logging
app.use(morgan("tiny"));

// Apply global rate limiter to all routes
app.use(apiLimiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static("./public"));

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(
  hpp({
    whitelist: ["duration", "totalQuestions", "difficultyLevel", "category"],
  })
);

// Add the keep-alive middleware here
app.use((req, res, next) => {
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=60, max=100"); // keep alive for 60secs and max request is 100
  next();
});

// 2) ROUTES
// Public route
// Health check route (exempted from rate limiting)
app.get("/health", async (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1;
  const redisStatus = await checkHealth();

  res.status(200).json({
    status: "success",
    message: "Server health check",
    services: {
      server: "healthy",
      database: mongoStatus ? "connected" : "disconnected",
      redis: redisStatus ? "connected" : "disconnected",
    },
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.send("Exam Portal API is running");
});

// API routes
app.use("/api/v1/exam", examRoute);
app.use("/api/v1/questions", questionsRoute);
app.use("/api/v1/payments", paymentRoute);
app.use("/api/v1/bundle-exam", bundleExamRoute);
app.use("/api/v1/exam-attempts", examAttemptRoute);

// Handle undefined routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// 3) ERROR HANDLING
app.use(errorController);

export default app;
