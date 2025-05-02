// Enhanced for high concurrency
import Redis from "ioredis";
import { promisify } from "util";

const createRedisClient = (prefix = "") => {
  // Determine if we should use clustered Redis based on environment
  const useCluster = process.env.REDIS_CLUSTER_ENABLED === "true";

  let redisClient;

  if (useCluster) {
    // Create a Redis Cluster client for high-scale environments
    const nodes = [];

    // Parse cluster nodes from environment variables
    const nodeCount = parseInt(process.env.REDIS_CLUSTER_NODES || "3", 10);
    for (let i = 1; i <= nodeCount; i++) {
      nodes.push({
        host: process.env[`REDIS_HOST_${i}`] || process.env.REDIS_HOST,
        port: parseInt(
          process.env[`REDIS_PORT_${i}`] || process.env.REDIS_PORT || "6379",
          10
        ),
      });
    }

    redisClient = new Redis.Cluster(nodes, {
      scaleReads: "slave", // Read from replica nodes
      maxRedirections: 16, // Maximum number of redirections
      retryDelayOnFailover: 100,
      retryDelayOnClusterDown: 100,
      retryDelayOnTryAgain: 100,
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        db: 0,
        keyPrefix: prefix,
        connectTimeout: 10000,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
        // Connection pool configuration
        connectionName: `exam-portal-${prefix}`,
        disconnectTimeout: 2000,
      },
    });
  } else {
    // Single Redis instance for development/testing
    redisClient = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
      db: 0,
      keyPrefix: prefix,
      // Enable reconnection
      retryStrategy(times) {
        const delay = Math.min(Math.pow(2, times) * 50, 2000);
        return delay;
      },
      // Error handling
      reconnectOnError(err) {
        const targetError = "READONLY";
        if (err.message.includes(targetError)) {
          // Only reconnect when the error matches
          return true;
        }
        return false;
      },
      connectionName: `exam-portal-${prefix}`,
      maxRetriesPerRequest: 3,
    });
  }

  // Error handling and logging
  redisClient.on("error", (err) => {
    console.error(`Redis client error (${prefix}):`, err);
  });

  redisClient.on("connect", () => {
    console.log(
      `Redis client connected (${prefix}) ${
        useCluster ? "in cluster mode" : ""
      }`
    );
  });

  // Add health check method
  redisClient.healthCheck = async () => {
    try {
      await redisClient.ping();
      return true;
    } catch (error) {
      console.error(`Redis health check failed (${prefix}):`, error);
      return false;
    }
  };

  return redisClient;
};

export default createRedisClient;
