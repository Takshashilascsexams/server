// ecosystem.config.js - PM2 configuration for high concurrency
module.exports = {
  apps: [
    {
      name: "exam-portal-api",
      script: "./src/index.js",
      instances: "max", // Use all available CPUs
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      // Graceful shutdown configuration
      kill_timeout: 5000, // Wait 5 seconds for graceful shutdown
      listen_timeout: 10000, // Wait 10 seconds for the app to boot
      wait_ready: true, // Wait for ready signal from app
      // Auto-restart settings
      max_restarts: 10,
      restart_delay: 5000,
      // Metrics for monitoring
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Load balancing strategy
      env: {
        PORT: 5000,
        INSTANCES: "max",
      },
    },
    {
      name: "exam-portal-worker",
      script: "./src/workers/index.js", // Create this worker file for background tasks
      instances: 2, // Run 2 worker instances
      exec_mode: "cluster",
      watch: false,
      env: {
        NODE_ENV: "production",
        WORKER_ONLY: "true",
      },
    },
  ],
};
