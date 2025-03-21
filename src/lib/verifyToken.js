import jwt from "jsonwebtoken";

const verifyToken = (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(403).json({ message: "Token is required" });
  }

  // Verify the token using Clerk's public key (you can retrieve Clerk's public key from their documentation or admin console)
  const decodedToken = jwt.verify(token, process.env.CLERK_SECRET_KEY, {
    algorithms: ["RS256"],
  });

  return decodedToken;
};

export default verifyToken;
