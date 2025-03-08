import app from "./app.js";
import { env } from "process";
import { connectDB } from "./lib/connectDB.js";

const PORT = env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}...`);
    });
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
};

startServer();
