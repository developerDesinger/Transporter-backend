const BroadcastService = require("../services/broadcast.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class BroadcastController {
  /**
   * Get broadcast history
   * GET /api/v1/broadcasts
   */
  static getBroadcasts = catchAsyncHandler(async (req, res) => {
    const broadcasts = await BroadcastService.getBroadcasts(req.user);
    return res.status(200).json({
      success: true,
      data: broadcasts,
    });
  });

  /**
   * Get drivers for broadcast with filtering
   * GET /api/v1/drivers/broadcast
   */
  static getDriversForBroadcast = catchAsyncHandler(async (req, res) => {
    const drivers = await BroadcastService.getDriversForBroadcast(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: drivers,
    });
  });

  /**
   * Get vehicle type codes for broadcast filtering
   * GET /api/v1/broadcasts/vehicle-types
   */
  static getVehicleTypes = catchAsyncHandler(async (req, res) => {
    const vehicleTypes = await BroadcastService.getVehicleTypes(req.user);
    return res.status(200).json({
      success: true,
      data: vehicleTypes,
    });
  });

  /**
   * Preview drivers matching filter criteria for broadcast
   * POST /api/v1/broadcasts/preview
   */
  static previewBroadcast = catchAsyncHandler(async (req, res) => {
    const result = await BroadcastService.previewBroadcast(req.body, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Send broadcast to drivers matching filter criteria
   * POST /api/v1/broadcasts
   */
  static sendBroadcast = catchAsyncHandler(async (req, res) => {
    const result = await BroadcastService.sendBroadcast(req.body, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get client broadcast history
   * GET /api/v1/client-broadcasts
   */
  static getClientBroadcasts = catchAsyncHandler(async (req, res) => {
    const broadcasts = await BroadcastService.getClientBroadcasts(req.user);
    return res.status(200).json({
      success: true,
      data: broadcasts,
    });
  });

  /**
   * Preview customers matching filter criteria for client broadcast
   * POST /api/v1/client-broadcasts/preview
   */
  static previewClientBroadcast = catchAsyncHandler(async (req, res) => {
    const result = await BroadcastService.previewClientBroadcast(req.body, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Send client broadcast to customers matching filter criteria
   * POST /api/v1/client-broadcasts
   */
  static sendClientBroadcast = catchAsyncHandler(async (req, res) => {
    const result = await BroadcastService.sendClientBroadcast(req.body, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

module.exports = BroadcastController;

