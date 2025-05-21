import verifyToken from "../lib/verifyToken.js";

/**
 * Authentication middleware that prioritizes exam continuity
 * Uses the improved verifyToken function to handle token validation
 */
const authenticateUser = (req, res, next) => {
  try {
    // For OPTIONS requests, just pass through for CORS preflight
    if (req.method === "OPTIONS") {
      return next();
    }

    // Check if this is an exam-related endpoint
    const isExamEndpoint = req.path.includes("/api/v1/exam-attempt/");

    // Verify the token and get result
    const result = verifyToken(req);

    // If token is valid, proceed normally
    if (result.success) {
      req.user = result.token;
      return next();
    }

    // Special handling for exam endpoints - prioritize continuity
    if (isExamEndpoint) {
      // Log the issue but allow the request to continue
      console.warn(
        `Auth issue in exam path ${req.path}: ${result.error.message}`
      );

      // If we have partial token info, use it
      if (result.partialToken) {
        console.log(`Using partial token info for exam endpoint: ${req.path}`);
        req.user = result.partialToken;
        req.tokenWarning = result.error.message;
        return next();
      }

      // Even without partial info, for time sync and answer submission, allow continuation
      if (
        req.path.includes("/time/") ||
        req.path.includes("/answer/") ||
        req.path.includes("/batch-answers/")
      ) {
        console.log(
          `Allowing critical exam operation despite auth failure: ${req.path}`
        );
        req.authBypass = true;
        req.tokenError = result.error.message;
        return next();
      }
    }

    // For non-exam endpoints or non-critical operations, return proper error
    return res.status(result.error.status).json({
      message: result.error.message,
      requiresAuth: true,
    });
  } catch (error) {
    console.error("Authentication middleware error:", error);

    // For exam endpoints, still try to continue
    if (req.path.includes("/api/v1/exam-attempt/")) {
      req.middlewareError = error.message;
      return next();
    }

    // For other endpoints, return error
    return res.status(500).json({
      message: "Authentication error",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
};

/**
 * Middleware to verify if a user is an admin
 */
const verifyUserIsAdmin = (req, res, next) => {
  try {
    // For OPTIONS requests, just pass through for CORS preflight
    if (req.method === "OPTIONS") {
      return next();
    }

    // Check if authentication middleware has run
    if (!req.user) {
      return res.status(401).json({ message: "User is not authenticated" });
    }

    // Check if the user has admin role in metadata
    if (req.user.metadata && req.user.metadata.role === "Admin") {
      return next();
    } else {
      return res.status(403).json({ message: "Admin access required" });
    }
  } catch (error) {
    console.error("Admin role verification error:", error);
    return res.status(403).json({ message: "User is not admin" });
  }
};

export { authenticateUser as verifyUserIsSignedIn, verifyUserIsAdmin };
