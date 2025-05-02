// app.js - Structured for high concurrency with 1,000+ users

// ----------------------------------------
// 1. IMPORTS
// ----------------------------------------

// Core libraries
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
import os from "os";

// Custom middleware and utilities
import compressResponse from "./utils/compressResponse.js";
import { AppError, errorController } from "./utils/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiterMiddleware.js";

// Services
import { checkHealth, examService } from "./services/redisService.js";

// Routes
import examRoute from "./routes/exam.routes.js";
import questionsRoute from "./routes/question.routes.js";
import paymentRoute from "./routes/payment.routes.js";
import bundleExamRoute from "./routes/bundle-exam.routes.js";
import examAttemptRoute from "./routes/exam-attempt.routes.js";

// ----------------------------------------
// 2. CONFIGURATION
// ----------------------------------------

// Load environment variables
dotenv.config();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize Express app
const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.CLIENT || "http://localhost:3000",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// High concurrency settings
const MAX_CONCURRENT_REQUESTS = 5000;
let currentRequests = 0;

// ----------------------------------------
// 3. ERROR HANDLING (PROCESS LEVEL)
// ----------------------------------------

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

// Graceful shutdown handler
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function gracefulShutdown() {
  console.log("Starting graceful shutdown...");

  // Stop accepting new connections
  if (global.server) {
    global.server.close(() => {
      console.log("HTTP server closed");
    });
  }

  // Allow existing requests to finish (wait up to 30 seconds)
  let shutdownTimeout = setTimeout(() => {
    console.log("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);

  try {
    // Wait for active requests to finish
    let waitInterval = setInterval(() => {
      console.log(
        `Waiting for ${currentRequests} active requests to finish...`
      );
      if (currentRequests <= 0) {
        clearInterval(waitInterval);
        clearTimeout(shutdownTimeout);

        // Close database connections
        console.log("Closing database connections...");
        mongoose.connection.close(false, () => {
          console.log("MongoDB connection closed");
          process.exit(0);
        });
      }
    }, 1000);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// ----------------------------------------
// 4. MIDDLEWARE SETUP
// ----------------------------------------

// Security and request parsing
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(helmet()); // Set security HTTP headers
app.use(compressResponse); // Response compression
app.use(apiLimiter); // Global rate limiting
app.use(morgan("tiny")); // Logging (development)

// Body parsers
app.use(
  express.json({
    limit: "5mb",
    strict: true,
    type: "application/json",
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: "5mb",
  })
);
app.use(express.static("./public"));

// Security middleware
app.use(mongoSanitize()); // NoSQL injection protection
app.use(xss()); // XSS protection
app.use(
  hpp({
    whitelist: ["duration", "totalQuestions", "difficultyLevel", "category"],
  })
);

// Connection optimization
app.use((req, res, next) => {
  // Optimize keep-alive settings
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=120, max=1000");

  // Add Cache-Control for static resources
  if (req.path.match(/\.(js|css|jpg|png|ico|svg|woff|woff2)$/)) {
    res.setHeader("Cache-Control", "public, max-age=86400");
  }

  next();
});

// Circuit breaker for high load
app.use((req, res, next) => {
  // Skip health and static endpoints
  if (
    req.path === "/health" ||
    req.path.match(/\.(js|css|jpg|png|ico|svg|woff|woff2)$/)
  ) {
    return next();
  }

  currentRequests++;
  res.on("finish", () => {
    currentRequests--;
  });

  // Circuit breaker for extreme load
  if (currentRequests > MAX_CONCURRENT_REQUESTS) {
    return res.status(503).json({
      status: "error",
      message:
        "Server is currently experiencing high load. Please try again shortly.",
      retryAfter: 5,
    });
  }

  next();
});

// ----------------------------------------
// 5. ROUTES
// ----------------------------------------

// Health check route
app.get("/health", async (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1;

  // Use cached Redis status to reduce check frequency
  let redisStatus = true;
  try {
    const cachedStatus = await examService.examCache.get("redis-health-status");

    if (cachedStatus === null) {
      // Only check Redis health every 30 seconds
      const healthResult = await checkHealth();
      redisStatus = healthResult.healthy;
      // Cache the status for 30 seconds
      await examService.examCache.set(
        "redis-health-status",
        redisStatus ? "ok" : "error",
        "EX",
        30
      );
    } else {
      redisStatus = cachedStatus === "ok";
    }
  } catch (error) {
    console.error("Redis health check error:", error);
    redisStatus = false;
  }

  // Add system load information
  const cpuLoad = os.loadavg()[0];
  const memoryUsage = process.memoryUsage();
  const systemLoad = {
    cpu: {
      load: cpuLoad,
      cores: os.cpus().length,
      loadPercentage: (cpuLoad / os.cpus().length) * 100,
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      processUsage: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
      },
    },
    uptime: process.uptime(),
    concurrentRequests: currentRequests,
  };

  res.status(200).json({
    status: "success",
    message: "Server health check",
    services: {
      server: "healthy",
      database: mongoStatus ? "connected" : "disconnected",
      redis: redisStatus ? "connected" : "disconnected",
    },
    load: systemLoad,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get("/", (req, res) => {
  res.send("Exam Portal API is running");
});

// API routes
app.use("/api/v1/exam", examRoute);
app.use("/api/v1/questions", questionsRoute);
app.use("/api/v1/payments", paymentRoute);
app.use("/api/v1/bundle-exam", bundleExamRoute);
app.use("/api/v1/exam-attempts", examAttemptRoute);

// ----------------------------------------
// 6. ERROR HANDLING (APPLICATION LEVEL)
// ----------------------------------------

// Handle undefined routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global error handler
app.use(errorController);

// ----------------------------------------
// 7. EXPORTS
// ----------------------------------------

export default app;
