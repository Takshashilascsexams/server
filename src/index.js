import app from "./app.js";
import { env } from "process";
import mongoose from "mongoose";
import { connectDB, monitorConnectionPool } from "./lib/connectDB.js";

// Enhanced connection pool configuration for exam portal
const MAX_CONNECTIONS = 300; // Up from 200 for better concurrent user support
const DB_CONNECTION_SAFETY_THRESHOLD = 270; // 90% of 300 - early warning threshold
const HIGH_USAGE_THRESHOLD = 210; // 70% of 300 - moderate warning threshold

const PORT = env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to database with expanded connection pool
    await connectDB();
    console.log(
      `MongoDB connected with enhanced connection pool (${MAX_CONNECTIONS} connections)`
    );

    // Print initial connection stats without using admin commands
    try {
      const poolStats = await monitorConnectionPool();
      console.log(`Initial MongoDB connection pool stats:`, {
        current: poolStats.current,
        available: poolStats.available,
        maxPoolSize: poolStats.maxPoolSize,
        utilization: poolStats.poolUtilization,
        status: getConnectionStatus(poolStats.current),
      });
    } catch (error) {
      console.warn(
        "Could not retrieve initial connection pool stats:",
        error.message
      );
    }

    // Start enhanced periodic monitoring of connection pool
    const monitoringInterval = env.NODE_ENV === "production" ? 30000 : 60000; // 30s in prod, 60s in dev

    setInterval(async () => {
      try {
        const stats = await monitorConnectionPool();
        const connectionStatus = getConnectionStatus(stats.current);

        // Enhanced logging based on connection pool utilization
        switch (connectionStatus.level) {
          case "CRITICAL":
            console.error(
              `🚨 CRITICAL: MongoDB connection pool at ${stats.poolUtilization} (${stats.current}/${MAX_CONNECTIONS}) - IMMEDIATE ACTION REQUIRED`
            );
            // In production, you might want to trigger alerts here
            if (env.NODE_ENV === "production") {
              // TODO: Implement alerting system (email, Slack, PagerDuty, etc.)
              console.error(
                "Consider scaling database resources or implementing connection throttling"
              );
            }
            break;

          case "HIGH":
            console.warn(
              `⚠️ HIGH: MongoDB connection pool at ${stats.poolUtilization} (${stats.current}/${MAX_CONNECTIONS}) - Monitor closely`
            );
            break;

          case "MODERATE":
            console.info(
              `📊 MODERATE: MongoDB connection pool at ${stats.poolUtilization} (${stats.current}/${MAX_CONNECTIONS})`
            );
            break;

          case "NORMAL":
            // Only log in development or if explicitly requested
            if (
              env.NODE_ENV !== "production" ||
              env.VERBOSE_LOGGING === "true"
            ) {
              console.log(
                `✅ NORMAL: MongoDB connection pool at ${stats.poolUtilization} (${stats.current}/${MAX_CONNECTIONS})`
              );
            }
            break;
        }

        // Additional exam-specific monitoring
        if (
          env.NODE_ENV === "production" &&
          stats.current > HIGH_USAGE_THRESHOLD
        ) {
          // Log additional context that might be helpful during exam periods
          console.info(
            `Connection pool metrics - Available: ${
              stats.available
            }, Active Requests: ${app.locals.currentRequests || 0}`
          );
        }
      } catch (err) {
        // Silent catch - don't crash the app on monitoring errors
        if (env.NODE_ENV !== "production") {
          console.warn("Connection pool monitoring error:", err.message);
        }
      }
    }, monitoringInterval);

    const server = app.listen(PORT, () => {
      console.log(
        `🚀 Server is running on port ${PORT} with enhanced DB connection pool (${MAX_CONNECTIONS} max connections)...`
      );
      console.log(
        `📊 Connection pool thresholds: High=${HIGH_USAGE_THRESHOLD}, Critical=${DB_CONNECTION_SAFETY_THRESHOLD}`
      );
    });

    // Set the timeout to 5 minutes (300000 ms) - good for long exam sessions
    server.timeout = 300000;

    // Store server in global for graceful shutdown
    global.server = server;

    // Enhanced graceful shutdown to properly clean up DB connections
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);

    // Handle uncaught exceptions gracefully
    process.on("uncaughtException", (error) => {
      console.error("Uncaught Exception:", error);
      gracefulShutdown();
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown();
    });
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
};

// Helper function to determine connection status level
const getConnectionStatus = (currentConnections) => {
  if (currentConnections >= DB_CONNECTION_SAFETY_THRESHOLD) {
    return { level: "CRITICAL", color: "🚨" };
  } else if (currentConnections >= HIGH_USAGE_THRESHOLD) {
    return { level: "HIGH", color: "⚠️" };
  } else if (currentConnections >= MAX_CONNECTIONS * 0.5) {
    return { level: "MODERATE", color: "📊" };
  } else {
    return { level: "NORMAL", color: "✅" };
  }
};

// Enhanced graceful shutdown function with improved DB connection handling
const gracefulShutdown = async () => {
  console.log(
    "🛑 Starting graceful shutdown with enhanced DB connection handling..."
  );

  // Stop accepting new connections
  if (global.server) {
    global.server.close(() => {
      console.log(
        "✅ HTTP server closed - no longer accepting new connections"
      );
    });
  }

  // Allow existing requests to finish (wait up to 30 seconds)
  let shutdownTimeout = setTimeout(() => {
    console.log("⏰ Forced shutdown after 30-second timeout");
    process.exit(1);
  }, 30000);

  try {
    // Check connection pool status before shutdown
    try {
      const stats = await monitorConnectionPool();
      console.log(
        `📊 DB connection pool stats before shutdown: active=${stats.current}/${MAX_CONNECTIONS}, utilization=${stats.poolUtilization}`
      );

      if (stats.current > 0) {
        console.log(
          `⏳ Waiting for ${stats.current} database connections to close...`
        );
      }
    } catch (err) {
      console.warn(
        "⚠️ Could not get connection stats before shutdown:",
        err.message
      );
    }

    // Wait for active requests to finish with enhanced logging
    let waitInterval = setInterval(() => {
      // Access the tracked requests from app.locals or use the global tracking variable
      const activeRequests = app.locals.currentRequests || 0;

      if (activeRequests > 0) {
        console.log(
          `⏳ Waiting for ${activeRequests} active requests to finish...`
        );
      }

      if (activeRequests <= 0) {
        clearInterval(waitInterval);
        clearTimeout(shutdownTimeout);

        // Close database connections with ample time for cleanup
        console.log("🔌 Closing database connections...");

        // Enhanced MongoDB connection closure
        mongoose.connection.close(false, (err) => {
          if (err) {
            console.error("❌ Error closing MongoDB connection:", err);
            process.exit(1);
          } else {
            console.log("✅ MongoDB connection pool cleanly closed");
            console.log("👋 Graceful shutdown completed successfully");
            process.exit(0);
          }
        });
      }
    }, 1000);

    // Additional safety: If shutdown takes too long, force close after 25 seconds
    setTimeout(() => {
      console.log(
        "⚠️ Shutdown taking longer than expected, forcing MongoDB closure..."
      );
      mongoose.connection.close(true, () => {
        console.log("✅ MongoDB connection forcefully closed");
        process.exit(0);
      });
    }, 25000);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
};

// Start the server
startServer().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
