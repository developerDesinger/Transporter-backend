// utils/catchAsyncHandler.js

const catchAsyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
module.exports = catchAsyncHandler;
