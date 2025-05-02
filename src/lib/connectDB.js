import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    const { connection } = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 100, // Increase connection pool size
      minPoolSize: 10, // Maintain minimum connections
      // Remove unsupported options
      // bufferMaxEntries, keepAlive, and keepAliveInitialDelay are no longer supported
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 10000,
    });

    if (connection.readyState === 1) {
      console.log("Connected to database.");
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
