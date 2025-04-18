import verifyToken from "../lib/verifyToken.js";

// Middleware to verify if a user is authenticated
const verifyUserIsSignedIn = (req, res, next) => {
  try {
    // For OPTIONS requests, just pass through for CORS preflight
    if (req.method === "OPTIONS") {
      return next();
    }

    const decodedToken = verifyToken(req, res);

    // Store user data in req.user
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("JWT verification error:", error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Middleware to verify if a user is an admin
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

export { verifyUserIsSignedIn, verifyUserIsAdmin };
