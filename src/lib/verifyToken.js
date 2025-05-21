import jwt from "jsonwebtoken";

/**
 * Improved token verification function that returns a result object
 * instead of directly sending responses or throwing uncaught exceptions
 *
 * @param {object} req - The request object containing headers
 * @returns {object} - Result object with token data or error information
 */
const verifyToken = (req) => {
  try {
    const token = req.headers["authorization"]?.split(" ")[1];

    if (!token) {
      return {
        error: {
          status: 403,
          message: "Token is required",
        },
      };
    }

    const publicKey = process.env.CLERK_SECRET_KEY;

    // Verify the token using Clerk's public key
    const decodedToken = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
    });

    // Return successful result
    return {
      success: true,
      token: decodedToken,
    };
  } catch (error) {
    // If token validation fails, try to extract basic info without verification
    const partialToken = extractPartialTokenInfo(req.headers["authorization"]);

    // Return error result
    return {
      success: false,
      error: {
        status: error.name === "TokenExpiredError" ? 401 : 403,
        message:
          error.name === "TokenExpiredError"
            ? "Token has expired"
            : "Invalid authentication token",
        originalError: error,
      },
      partialToken: partialToken,
    };
  }
};

/**
 * Extracts basic token information without verification
 * Useful for maintaining some context when tokens are invalid/expired
 */
function extractPartialTokenInfo(authHeader) {
  if (!authHeader) return null;

  try {
    const token = authHeader.split(" ")[1];
    if (!token) return null;

    // Basic token structure check
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Decode the payload (middle part) without verification
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());

    return payload;
  } catch (e) {
    console.error("Error extracting partial token info:", e);
    return null;
  }
}

export default verifyToken;
