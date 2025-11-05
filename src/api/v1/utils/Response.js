class Response {
  static success(res, message, statusCode, result) {
    return res.status(statusCode).json({
      status: true,
      message: message,
      data: result,
    });
  }

  static error(res, message, statusCode = 500, result) {
    return res.status(statusCode).json({
      status: false,
      message: message,
      data: result,
    });
  }
}

module.exports = Response;
