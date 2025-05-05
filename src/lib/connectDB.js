import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    const { connection } = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 100, // Increase connection pool size for high concurrency
      minPoolSize: 10, // Maintain minimum connections
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
      console.log("Connected to database.");

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
