import jwt from "jsonwebtoken";

const verifyToken = (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(403).json({ message: "Token is required" });
  }

  const publicKey = process.env.CLERK_SECRET_KEY;

  // Verify the token using Clerk's public key
  const decodedToken = jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
  });

  return decodedToken;
};

export default verifyToken;
