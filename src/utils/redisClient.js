// src/utils/redisClient.js
import Redis from "ioredis";

const createRedisClient = (prefix = "") => {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    keyPrefix: prefix,
    // Enable reconnection
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    // Add connection error handler
    reconnectOnError(err) {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        // Only reconnect when the error matches
        return true;
      }
      return false;
    },
  });
};

export default createRedisClient;
