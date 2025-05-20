import Redis from "ioredis";

const createRedisClient = (prefix = "") => {
  const isDev = process.env.NODE_ENV !== "production";
  const useCluster = process.env.REDIS_CLUSTER_ENABLED === "true";

  let redisClient;

  // Development environment - use local Redis
  if (isDev) {
    console.log(`Using local Redis for development (${prefix})`);
    redisClient = new Redis({
      host: "localhost",
      port: 6379,
      keyPrefix: prefix,
      family: 0, // Enable dual stack lookup
      // Enable reconnection
      retryStrategy(times) {
        const delay = Math.min(Math.pow(2, times) * 50, 2000);
        return delay;
      },
      connectionName: `exam-portal-${prefix}-dev`,
      maxRetriesPerRequest: 3,
    });
  }
  // Production with Redis Cluster
  else if (useCluster) {
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
        family: 0, // Enable dual stack lookup for each node
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
        family: 0, // Enable dual stack lookup
        // Connection pool configuration
        connectionName: `exam-portal-${prefix}`,
        disconnectTimeout: 2000,
      },
    });
  }
  // Production with REDIS_URL (preferred method)
  else if (process.env.REDIS_URL) {
    console.log(`Using REDIS_URL for ${prefix} (private endpoint)`);

    // Make sure the URL has the family parameter
    let redisUrl = process.env.REDIS_URL;
    if (!redisUrl.includes("family=")) {
      redisUrl = redisUrl.includes("?")
        ? `${redisUrl}&family=0`
        : `${redisUrl}?family=0`;
    }

    redisClient = new Redis(redisUrl, {
      keyPrefix: prefix,
      family: 0, // Redundant but ensures it's set even if URL parameter fails
      retryStrategy(times) {
        const delay = Math.min(Math.pow(2, times) * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = "READONLY";
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
      connectionName: `exam-portal-${prefix}`,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
    });
  }
  // Fallback to individual configuration variables
  else {
    console.log(`Using individual Redis config variables for ${prefix}`);
    redisClient = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
      db: 0,
      keyPrefix: prefix,
      family: 0, // Enable dual stack lookup
      // Enable reconnection
      retryStrategy(times) {
        const delay = Math.min(Math.pow(2, times) * 50, 2000);
        return delay;
      },
      // Error handling
      reconnectOnError(err) {
        const targetError = "READONLY";
        if (err.message.includes(targetError)) {
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

  // Add batch operation methods to better support frontend batched submissions
  redisClient.batchProcess = async (batchKey, processor, options = {}) => {
    const { batchSize = 50, lockTime = 10, waitBetweenBatches = 50 } = options;

    const lockKey = `lock:${batchKey}`;
    let processed = 0;

    try {
      // Try to acquire lock
      const acquired = await redisClient.set(
        lockKey,
        Date.now(),
        "NX",
        "EX",
        lockTime
      );

      if (!acquired) {
        return 0; // Another process is handling this batch
      }

      // Get batch items
      const items = await redisClient.lrange(batchKey, 0, batchSize - 1);
      if (!items || items.length === 0) {
        return 0;
      }

      // Process items
      for (const item of items) {
        try {
          await processor(JSON.parse(item));
          processed++;

          // Remove processed item
          await redisClient.lrem(batchKey, 1, item);

          // Small delay to prevent overwhelming resources
          if (waitBetweenBatches > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, waitBetweenBatches)
            );
          }
        } catch (err) {
          console.error(`Error processing batch item: ${err.message}`);
          // Move to error queue instead of losing the item
          await redisClient.rpush(`${batchKey}:errors`, item);
          await redisClient.lrem(batchKey, 1, item);
        }
      }

      return processed;
    } catch (error) {
      console.error(`Batch processing error for ${batchKey}:`, error);
      return 0;
    } finally {
      // Release lock regardless of outcome
      await redisClient.del(lockKey);
    }
  };

  return redisClient;
};

export default createRedisClient;
