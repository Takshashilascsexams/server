import multer from "multer";

export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

export const errorController = (err, req, res, next) => {
  // Multer error handler
  if (err instanceof multer.MulterError) {
    // A Multer error occurred during file upload
    return res.status(400).json({
      status: "fail",
      message: `Upload error: ${err.message}`,
      code: err.code,
    });
  }

  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Development error response (more details)
  if (process.env.NODE_ENV === "development") {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  }

  // Production error response (less details for security)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  // Programming or unknown errors: don't leak error details
  console.error("ERROR 💥", err);
  return res.status(500).json({
    status: "error",
    message: "Something went wrong",
  });
};
