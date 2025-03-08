import * as dotenv from "dotenv";
import { env } from "process";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import rateLimit from "express-rate-limit";
import hpp from "hpp";
import { clerkMiddleware } from "@clerk/express";
import { AppError, errorController } from "./utils/errorHandler.js";

// routes
import examRoute from "./routes/exam.routes.js";

dotenv.config();

// Uncaught exception handler
process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! 💥 Shutting down...");
  console.log(err.name, err.message);
  process.exit(1);
});

const app = express();

// 1) GLOBAL MIDDLEWARES
// Set security HTTP headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Limit requests from same IP
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: "Too many requests from this IP, please try again in an hour!",
});
app.use("/api", limiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
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

const corsOptions = {
  origin: env.CLIENT,
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Apply Clerk middleware globally
app.use(clerkMiddleware());

// 2) ROUTES
// Public route
app.get("/", (req, res) => {
  res.send("Exam Portal API is running");
});

// API routes
app.use("/api/v1/exam", examRoute);

// Handle undefined routes
app.all("*", (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// 3) ERROR HANDLING
app.use(errorController);

export default app;
