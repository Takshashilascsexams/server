module.exports = {
  apps: [
    {
      name: "exam-portal-server",
      script: "src/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
        DEBUG: "app:*",
        WATCH: true,
      },
      env_production: {
        NODE_ENV: "production",
        WATCH: false,
      },
    },
    {
      name: "exam-portal-worker",
      script: "src/workers/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
        DEBUG: "app:*",
        WATCH: true,
      },
      env_production: {
        NODE_ENV: "production",
        WATCH: false,
      },
    },
    {
      name: "exam-processor",
      script: "src/workers/exam-processor.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      env_development: {
        NODE_ENV: "development",
        DEBUG: "app:*",
        WATCH: true,
      },
      env_production: {
        NODE_ENV: "production",
        WATCH: false,
      },
    },
  ],
};
