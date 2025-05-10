import app from "./app.js";
import { env } from "process";
import mongoose from "mongoose";
import { connectDB, monitorConnectionPool } from "./lib/connectDB.js";

const PORT = env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to database with expanded connection pool
    await connectDB();
    console.log(
      "MongoDB connected with expanded connection pool (200 connections)"
    );

    // Print initial connection stats without using admin commands
    try {
      const poolStats = await monitorConnectionPool();
      console.log(`Initial MongoDB connection pool stats:`, poolStats);
    } catch (error) {
      console.warn(
        "Could not retrieve initial connection pool stats:",
        error.message
      );
    }

    // Start periodic monitoring of connection pool in production
    if (env.NODE_ENV === "production") {
      setInterval(async () => {
        try {
          const stats = await monitorConnectionPool();
          // Log if utilization is high
          if (stats.current > stats.maxPoolSize * 0.8) {
            console.warn(
              `⚠️ High MongoDB connection pool utilization: ${stats.poolUtilization}`
            );
          }
        } catch (err) {
          // Silent catch - don't crash the app on monitoring errors
        }
      }, 30000); // Every 30 seconds
    }

    const server = app.listen(PORT, () => {
      console.log(
        `Server is running on port ${PORT} with enhanced DB connection pool...`
      );
    });

    // Set the timeout to 5 minutes (300000 ms)
    server.timeout = 300000;

    // Store server in global for graceful shutdown
    global.server = server;

    // Enhanced graceful shutdown to properly clean up DB connections
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
};

// Enhanced graceful shutdown function
const gracefulShutdown = async () => {
  console.log(
    "Starting graceful shutdown with enhanced DB connection handling..."
  );

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
    // Check connection pool status before shutdown
    try {
      const stats = await monitorConnectionPool();
      console.log(
        `DB connection pool stats before shutdown: active=${stats.current}, utilization=${stats.poolUtilization}`
      );
    } catch (err) {
      console.warn("Could not get connection stats before shutdown");
    }

    // Wait for active requests to finish
    let waitInterval = setInterval(() => {
      // Access the tracked requests from app.locals or use the global tracking variable
      const activeRequests = app.locals.currentRequests || 0;
      console.log(`Waiting for ${activeRequests} active requests to finish...`);

      if (activeRequests <= 0) {
        clearInterval(waitInterval);
        clearTimeout(shutdownTimeout);

        // Close database connections with ample time for cleanup
        console.log("Closing database connections...");
        mongoose.connection.close(false, () => {
          console.log("MongoDB connection pool cleanly closed");
          process.exit(0);
        });
      }
    }, 1000);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

startServer();
