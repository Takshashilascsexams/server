import compression from "compression";
import { constants } from "zlib";

const compressResponse = compression({
  // Only compress responses larger than 1KB
  threshold: 1024,

  // Configure Brotli compression
  brotli: {
    enabled: true,
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 4,
    },
  },

  // Configure gzip as well for broader compatibility
  level: 6, // Balance between compression speed and ratio for gzip

  // Custom filter function
  filter: (req, res) => {
    // Don't compress already compressed resources
    if (
      req.headers["content-type"]?.includes("image/") ||
      req.headers["content-type"]?.includes("video/") ||
      req.headers["content-type"]?.includes("application/pdf")
    ) {
      return false;
    }

    // Always compress JSON responses
    if (
      req.headers["accept"]?.includes("application/json") ||
      res.getHeader("Content-Type")?.includes("application/json")
    ) {
      return true;
    }

    // Use default filter for everything else
    return compression.filter(req, res);
  },
});

export default compressResponse;
