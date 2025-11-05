const AppError = require("../utils/AppError");

// Specific error handlers for database-related errors
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400); // Use 400 for client errors like invalid IDs
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.keyValue ? Object.values(err.keyValue)[0] : "unknown value";
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 409); // Use 409 for conflict errors like duplicates
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data: ${errors.join(". ")}`;
  return new AppError(message, 400); // Use 400 for validation errors
};

// Development error handler: Shows detailed error and stack trace
const sendErrorDev = (err, res) => {
  console.log("Error: ", err.message);
  console.log("Stack: ", err.stack);

  return res.status(err.statusCode).json({
    status: false,
    // status: err.status,
    message: err.message,
    stack: err.stack, // Stack trace should be included in development only
    data: [],
  });
};

// Production error handler: Hides detailed error stack and logs for unknown errors
const sendErrorProd = (err, res) => {
  // Only send operational errors to the client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: false,
      message: err.message,
      data: null,
    });
  }

  // For unknown or programming errors, hide details and log them
  console.error("ERROR 💥", err);

  return res.status(500).json({
    status: false,
    message: "Something went wrong! Please try again later.",
  });
};

// Global error handler
const globalErrorHandler = (err, req, res, next) => {
  // Set default values for error properties
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // In development, provide detailed error information
  if (true) {
    let error = { ...err };
    error.message = err.message; // Ensure error message is copied over

    // Handle specific errors by name or code
    if (err.name === "CastError") error = handleCastErrorDB(error);
    if (err.code === 11000) error = handleDuplicateFieldsDB(error);
    if (err.name === "ValidationError") error = handleValidationErrorDB(err);

    sendErrorDev(error, res);
  }
  // // In development, provide detailed error information
  // if (process.env.NODE_ENV === "DEVELOPMENT") {
  //   let error = { ...err };
  //   error.message = err.message; // Ensure error message is copied over

  //   // Handle specific errors by name or code
  //   if (err.name === "CastError") error = handleCastErrorDB(error);
  //   if (err.code === 11000) error = handleDuplicateFieldsDB(error);
  //   if (err.name === "ValidationError") error = handleValidationErrorDB(err);

  //   sendErrorDev(error, res);
  // }

  // // In production, send minimal error info
  // if (process.env.NODE_ENV === "PRODUCTION") {
  //   let error = { ...err };
  //   error.message = err.message; // Ensure error message is copied over

  //   // Handle specific errors by name or code
  //   if (err.name === "CastError") error = handleCastErrorDB(error);
  //   if (err.code === 11000) error = handleDuplicateFieldsDB(error);
  //   if (err.name === "ValidationError") error = handleValidationErrorDB(err);

  //   sendErrorProd(error, res);
  // }
};

module.exports = globalErrorHandler;
