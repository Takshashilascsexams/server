import express from "express";
import path from "path";

const servePublicationsMiddleware = express.static(
  path.join(process.cwd(), "uploads", "publications"),
  {
    setHeaders: (res) => {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
    },
  }
);

export default servePublicationsMiddleware;
