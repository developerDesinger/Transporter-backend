class AppError extends Error {
  constructor(message, statusCode) {
    console.log("AT_APP_ERROR : ", message);
    super(message);
    this.message = message;
    this.statusCode = statusCode;
    // Set status to true for success (2xx), false for error (4xx, 5xx)
    this.status = `${statusCode}`.startsWith("2") ? true : false;
    // console.log(this.status);

    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
