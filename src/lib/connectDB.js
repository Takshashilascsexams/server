import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    const { connection } = await mongoose.connect(process.env.MONGO_URI);
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
    console.error(error);
    return Promise.reject(error);
  }
};
