import verifyToken from "../lib/verifyToken.js";

// Middleware to verify if a user is authenticated
const verifyUserIsSignedIn = (req, res, next) => {
  try {
    const decodedToken = verifyToken(req, res);

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
    if (!req.user) {
      return res.status(401).json({ message: "User is not authenticated" });
    }

    // Check if the user has admin role in metadata (using "Admin" as you specified)
    if (req.user.metadata && req.user.metadata.role === "Admin") {
      next();
    } else {
      return res.status(403).json({ message: "Admin access required" });
    }
  } catch (error) {
    console.error("Admin role verification error:", error);
    return res.status(401).json({ message: "User is not admin" });
  }
};

export { verifyUserIsSignedIn, verifyUserIsAdmin };
