// src/utils/loadBalancer.js
import os from "os";
import createRedisClient from "./redisClient.js";

// Create a dedicated Redis client for load balancing
const loadBalancerRedis = createRedisClient("loadbalancer:");

/**
 * Load balancer utility for handling high traffic and exam concurrency
 * - Monitors system resources and active connections
 * - Distributes load across instances using Redis for coordination
 * - Prevents server overload during peak usage
 */
class LoadBalancer {
  constructor() {
    // Configuration options
    this.options = {
      // Maximum CPU usage percentage before considering overloaded
      maxCpuUsage: process.env.MAX_CPU_USAGE || 85,

      // Maximum memory usage percentage before considering overloaded
      maxMemoryUsage: process.env.MAX_MEMORY_USAGE || 85,

      // Maximum concurrent exams per server instance
      maxConcurrentExams: process.env.MAX_CONCURRENT_EXAMS || 1000,

      // Monitoring interval in milliseconds
      monitorInterval: process.env.MONITOR_INTERVAL || 5000,

      // Key expiration time in seconds (should be longer than monitorInterval)
      keyExpiration: process.env.KEY_EXPIRATION || 10,

      // Global concurrency limit across all instances
      globalConcurrencyLimit: process.env.GLOBAL_CONCURRENCY_LIMIT || 10000,

      // Redis key for tracking active exams
      redisActiveExamsKey: "active_exams",

      // Redis key for tracking server status
      redisServerStatusKey: "server_status",

      // Server instance ID (should be unique per instance)
      serverId:
        process.env.SERVER_ID ||
        `server_${Math.random().toString(36).substr(2, 9)}`,

      // Enable/disable load balancing
      enabled: process.env.ENABLE_LOAD_BALANCING !== "false",
    };

    // Active exam sessions being tracked
    this.activeExams = new Map();

    // Last recorded stats
    this.lastStats = {
      cpuUsage: 0,
      memoryUsage: 0,
      activeExams: 0,
      isOverloaded: false,
      timestamp: Date.now(),
    };

    // Start monitoring if enabled
    if (this.options.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Start periodic monitoring of system resources
   */
  startMonitoring() {
    // Set up monitoring interval
    this.monitorInterval = setInterval(() => {
      this.updateServerStatus();
    }, this.options.monitorInterval);

    // Perform initial update
    this.updateServerStatus();

    console.log(`Load balancer initialized with ID ${this.options.serverId}`);
  }

  /**
   * Update server status in Redis for coordination
   */
  async updateServerStatus() {
    try {
      // Get current CPU usage (average across all cores)
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;

      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      }

      const cpuUsage = 100 - Math.floor((100 * totalIdle) / totalTick);

      // Get current memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memoryUsage = Math.floor((100 * (totalMem - freeMem)) / totalMem);

      // Get current active exams count
      const activeExamsCount = this.activeExams.size;

      // Determine if server is overloaded
      const isOverloaded =
        cpuUsage > this.options.maxCpuUsage ||
        memoryUsage > this.options.maxMemoryUsage ||
        activeExamsCount > this.options.maxConcurrentExams;

      // Update last stats
      this.lastStats = {
        cpuUsage,
        memoryUsage,
        activeExams: activeExamsCount,
        isOverloaded,
        timestamp: Date.now(),
      };

      // Save to Redis for coordination across instances
      const serverStatus = {
        serverId: this.options.serverId,
        cpuUsage,
        memoryUsage,
        activeExams: activeExamsCount,
        isOverloaded,
        timestamp: Date.now(),
      };

      // Update server status in Redis with expiration
      await loadBalancerRedis.hset(
        this.options.redisServerStatusKey,
        this.options.serverId,
        JSON.stringify(serverStatus)
      );

      // Set expiration for the hash
      await loadBalancerRedis.expire(
        this.options.redisServerStatusKey,
        this.options.keyExpiration
      );

      // Log warning if server is overloaded
      if (isOverloaded) {
        console.warn(
          `Server ${this.options.serverId} is overloaded: CPU ${cpuUsage}%, ` +
            `Memory ${memoryUsage}%, Active exams: ${activeExamsCount}`
        );
      }
    } catch (error) {
      console.error("Error updating server status:", error);
    }
  }

  /**
   * Register an active exam session
   * @param {string} attemptId - The exam attempt ID
   * @param {string} userId - The user ID
   */
  async registerExamSession(attemptId, userId) {
    if (!this.options.enabled) return;

    try {
      const sessionKey = `${userId}:${attemptId}`;

      // Add to local tracking
      this.activeExams.set(sessionKey, {
        attemptId,
        userId,
        startTime: Date.now(),
      });

      // Increment global counter in Redis
      await loadBalancerRedis.hincrby(
        this.options.redisActiveExamsKey,
        "count",
        1
      );

      // Set expiration for the hash
      await loadBalancerRedis.expire(
        this.options.redisActiveExamsKey,
        this.options.keyExpiration * 2
      );
    } catch (error) {
      console.error("Error registering exam session:", error);
    }
  }

  /**
   * Unregister an active exam session
   * @param {string} attemptId - The exam attempt ID
   * @param {string} userId - The user ID
   */
  async unregisterExamSession(attemptId, userId) {
    if (!this.options.enabled) return;

    try {
      const sessionKey = `${userId}:${attemptId}`;

      // Remove from local tracking
      if (this.activeExams.has(sessionKey)) {
        this.activeExams.delete(sessionKey);

        // Decrement global counter in Redis
        await loadBalancerRedis.hincrby(
          this.options.redisActiveExamsKey,
          "count",
          -1
        );
      }
    } catch (error) {
      console.error("Error unregistering exam session:", error);
    }
  }

  /**
   * Check if the system is currently overloaded
   * @returns {Promise<boolean>} - Whether the system is overloaded
   */
  async isOverloaded() {
    if (!this.options.enabled) return false;

    try {
      // Check local status first for quick response
      if (this.lastStats.isOverloaded) {
        return true;
      }

      // Check global active exam count
      const globalCount = await loadBalancerRedis.hget(
        this.options.redisActiveExamsKey,
        "count"
      );

      if (
        globalCount &&
        parseInt(globalCount) > this.options.globalConcurrencyLimit
      ) {
        return true;
      }

      // Check all server statuses
      const serverStatuses = await loadBalancerRedis.hgetall(
        this.options.redisServerStatusKey
      );

      // If no statuses found, return false (assume not overloaded)
      if (!serverStatuses) {
        return false;
      }

      // Check if all servers are overloaded
      const allOverloaded = Object.values(serverStatuses).every(
        (statusJson) => {
          try {
            const status = JSON.parse(statusJson);
            return status.isOverloaded;
          } catch (e) {
            return false;
          }
        }
      );

      return allOverloaded;
    } catch (error) {
      console.error("Error checking system overload status:", error);
      return false; // Default to not overloaded on error
    }
  }

  /**
   * Get the best server for a new exam
   * @returns {Promise<string|null>} - ID of the best server, or null if all overloaded
   */
  async getBestServer() {
    if (!this.options.enabled) return this.options.serverId;

    try {
      // Get all server statuses
      const serverStatuses = await loadBalancerRedis.hgetall(
        this.options.redisServerStatusKey
      );

      if (!serverStatuses || Object.keys(serverStatuses).length === 0) {
        return this.options.serverId; // Default to current server if no status info
      }

      // Parse and filter non-overloaded servers
      const availableServers = Object.entries(serverStatuses)
        .map(([serverId, statusJson]) => {
          try {
            const status = JSON.parse(statusJson);
            return { serverId, ...status };
          } catch (e) {
            return null;
          }
        })
        .filter((server) => server && !server.isOverloaded);

      if (availableServers.length === 0) {
        return null; // All servers are overloaded
      }

      // Sort by least active exams
      availableServers.sort((a, b) => a.activeExams - b.activeExams);

      return availableServers[0].serverId;
    } catch (error) {
      console.error("Error finding best server:", error);
      return this.options.serverId; // Default to current server on error
    }
  }

  /**
   * Stop monitoring and clean up resources
   */
  shutdown() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    // Clean up Redis entries for this server
    try {
      loadBalancerRedis.hdel(
        this.options.redisServerStatusKey,
        this.options.serverId
      );
    } catch (error) {
      console.error("Error during load balancer shutdown:", error);
    }
  }
}

// Create and export singleton instance
export const loadBalancer = new LoadBalancer();

// Clean up on process exit
process.on("SIGTERM", () => {
  loadBalancer.shutdown();
});

process.on("SIGINT", () => {
  loadBalancer.shutdown();
});

export default loadBalancer;
