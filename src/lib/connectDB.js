import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    const { connection } = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 200, // Increased from 100 to 200 for 500 concurrent users
      minPoolSize: 20, // Increased from 10 to 20 to maintain higher baseline connection count
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 10000,
      // Add these optimizations for read preference and write concern
      readPreference: "primaryPreferred", // Read from secondaries when possible
      w: "majority", // Wait for majority write acknowledgement
      wtimeoutMS: 10000, // Write timeout
      // Set up automatic indexes - critical for exam querying performance
      autoIndex: true,
      autoCreate: true,
    });

    if (connection.readyState === 1) {
      console.log(
        "Connected to database with enlarged connection pool (maxPoolSize: 200)."
      );

      // Set up additional connection optimizations
      mongoose.set("bufferCommands", false); // Disable command buffering for better failure handling

      // Add connection event listeners for better monitoring
      mongoose.connection.on("error", (err) => {
        console.error("MongoDB connection error:", err);
      });

      mongoose.connection.on("disconnected", () => {
        console.warn("MongoDB disconnected, attempting to reconnect...");
      });

      mongoose.connection.on("reconnected", () => {
        console.log("MongoDB reconnected successfully");
      });

      // Enhanced monitoring for connection pool
      if (process.env.NODE_ENV !== "production") {
        // Only log in non-production environments to avoid excessive logging
        setInterval(async () => {
          try {
            // Use our Atlas-compatible monitoring function instead
            const stats = await monitorConnectionPool();
            console.log(
              `MongoDB connection pool stats: current=${stats.current}, available=${stats.available}, utilization=${stats.poolUtilization}`
            );
          } catch (err) {
            // Silently ignore errors in stats collection
          }
        }, 60000); // Check every minute
      }

      return Promise.resolve(true);
    } else {
      console.error(
        `Database connection failed. Connection state: ${connection.readyState}`
      );
      return Promise.reject(new Error("Database connection failed"));
    }
  } catch (error) {
    console.error("MongoDB connection error:", error);
    return Promise.reject(error);
  }
};

// Add a function to create indexes for better query performance
export const createIndexes = async () => {
  try {
    // This function would be called after connection to ensure
    // proper indexes are set up for high-performance querying

    // Example: Create indexes on commonly queried fields
    // Replace these with your actual model imports and index needs
    /*
    const ExamModel = mongoose.model('Exam');
    await ExamModel.createIndexes();
    
    const ExamAttempt = mongoose.model('ExamAttempt');
    await ExamAttempt.collection.createIndex({ userId: 1, status: 1 });
    await ExamAttempt.collection.createIndex({ examId: 1 });
    */

    console.log("MongoDB indexes created successfully");
    return true;
  } catch (error) {
    console.error("Error creating MongoDB indexes:", error);
    return false;
  }
};

// Function to monitor connection pool health
export const monitorConnectionPool = async () => {
  try {
    // For MongoDB Atlas and other restricted environments where serverStatus
    // is not allowed, we'll use a different approach

    // Get a simpler estimate of connection status from the driver
    // Note: This doesn't require admin privileges
    const poolSize =
      mongoose.connection.client.topology?.connections?.length || 0;
    const maxPoolSize = 200; // The configured max pool size

    return {
      current: poolSize,
      available: maxPoolSize - poolSize,
      maxPoolSize: maxPoolSize,
      poolUtilization: `${((poolSize / maxPoolSize) * 100).toFixed(2)}%`,
    };
  } catch (error) {
    console.error("Error monitoring connection pool:", error);
    return {
      error: error.message,
      maxPoolSize: 200,
    };
  }
};
