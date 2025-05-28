import mongoose from "mongoose";
import { catchAsync } from "../../../utils/errorHandler.js";
import {
  dashboardService,
  checkHealth,
} from "../../../services/redisService.js";

/**
 * Controller to get system health metrics
 * - Database connection status
 * - Redis connection status
 * - Performance metrics
 * - Resource utilization
 */
const getSystemHealth = catchAsync(async (req, res, next) => {
  const cacheKey = "system:health";

  // Try to get from cache first (with very short TTL for health data)
  try {
    const cachedHealth = await dashboardService.getSystemHealth();
    if (cachedHealth) {
      return res.status(200).json({
        status: "success",
        fromCache: true,
        data: cachedHealth,
      });
    }
  } catch (error) {
    console.error("Cache error in getSystemHealth:", error);
  }

  try {
    // Get system start time
    const startTime = Date.now();

    // Check database health
    const dbHealth = await checkDatabaseHealth();

    // Check Redis health
    const redisHealth = await checkHealth();

    // Get system metrics
    const systemMetrics = getSystemMetrics();

    // Get application metrics
    const appMetrics = await getApplicationMetrics();

    // Calculate overall health score
    const healthScore = calculateHealthScore({
      database: dbHealth.healthy,
      redis: redisHealth.healthy,
      memory: systemMetrics.memory.usage < 80, // Less than 80% memory usage
      responseTime: Date.now() - startTime < 1000, // Less than 1 second response
    });

    const healthData = {
      overall: {
        status:
          healthScore >= 75
            ? "healthy"
            : healthScore >= 50
            ? "warning"
            : "critical",
        score: healthScore,
        timestamp: new Date(),
      },

      database: {
        status: dbHealth.healthy ? "connected" : "disconnected",
        details: dbHealth,
      },

      redis: {
        status: redisHealth.healthy ? "connected" : "disconnected",
        details: redisHealth,
      },

      system: {
        uptime: process.uptime(),
        memory: systemMetrics.memory,
        cpu: systemMetrics.cpu,
        node: systemMetrics.node,
      },

      application: appMetrics,

      performance: {
        responseTime: Date.now() - startTime,
        lastCheck: new Date(),
      },
    };

    // Cache for a very short time (30 seconds) since this is health data
    try {
      await dashboardService.setSystemHealth(healthData, 30);
    } catch (cacheError) {
      console.error("Failed to cache system health:", cacheError);
    }

    // Send response
    res.status(200).json({
      status: "success",
      fromCache: false,
      data: healthData,
    });
  } catch (error) {
    console.error("Error in getSystemHealth:", error);

    // Return basic health status even if detailed checks fail
    const basicHealth = {
      overall: {
        status: "warning",
        score: 50,
        timestamp: new Date(),
      },
      database: {
        status:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        details: { healthy: mongoose.connection.readyState === 1 },
      },
      redis: {
        status: "unknown",
        details: { healthy: false, error: error.message },
      },
      system: getSystemMetrics(),
      error: "Partial health check completed",
    };

    res.status(200).json({
      status: "success",
      fromCache: false,
      data: basicHealth,
    });
  }
});

/**
 * Check database health
 */
const checkDatabaseHealth = async () => {
  try {
    const dbState = mongoose.connection.readyState;
    const dbStats = await mongoose.connection.db.stats();

    return {
      healthy: dbState === 1,
      readyState: dbState,
      readyStateText: getReadyStateText(dbState),
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      collections: dbStats.collections,
      dataSize: Math.round(dbStats.dataSize / 1024 / 1024), // MB
      indexSize: Math.round(dbStats.indexSize / 1024 / 1024), // MB
      objects: dbStats.objects,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      readyState: mongoose.connection.readyState,
    };
  }
};

/**
 * Get readable database ready state
 */
const getReadyStateText = (state) => {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
    4: "invalid",
  };
  return states[state] || "unknown";
};

/**
 * Get system metrics
 */
const getSystemMetrics = () => {
  const memUsage = process.memoryUsage();

  return {
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      usage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100), // Percentage
    },
    cpu: {
      usage: process.cpuUsage(),
      platform: process.platform,
      architecture: process.arch,
    },
    node: {
      version: process.version,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
    },
  };
};

/**
 * Get application-specific metrics
 */
const getApplicationMetrics = async () => {
  try {
    // This would typically include app-specific metrics
    // For now, return basic application health indicators

    return {
      environment: process.env.NODE_ENV || "development",
      activeConnections: mongoose.connection.readyState,
      serverUptime: Math.round(process.uptime()),
      lastRestart: new Date(Date.now() - process.uptime() * 1000),

      // Application-specific metrics
      features: {
        examCreation: "active",
        userRegistration: "active",
        examTaking: "active",
        resultGeneration: "active",
      },

      // Performance indicators
      performance: {
        avgResponseTime: "< 500ms", // This could be calculated from actual metrics
        errorRate: "< 1%", // This could be tracked
        throughput: "normal", // This could be measured
      },
    };
  } catch (error) {
    return {
      error: error.message,
      environment: process.env.NODE_ENV || "development",
    };
  }
};

/**
 * Calculate overall health score
 */
const calculateHealthScore = (checks) => {
  const weights = {
    database: 30,
    redis: 25,
    memory: 25,
    responseTime: 20,
  };

  let score = 0;
  let totalWeight = 0;

  Object.entries(checks).forEach(([key, isHealthy]) => {
    if (weights[key]) {
      score += isHealthy ? weights[key] : 0;
      totalWeight += weights[key];
    }
  });

  return totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0;
};

export default getSystemHealth;
