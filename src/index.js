import app from "./app.js";
import { env } from "process";
import { connectDB } from "./lib/connectDB.js";

const PORT = env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    const server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}...`);
    });

    // Set the timeout to 5 minutes (300000 ms)
    server.timeout = 300000;
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
};

startServer();
