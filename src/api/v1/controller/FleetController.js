const FleetService = require("../services/fleet.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class FleetController {
  /**
   * Get fleet status summary for dashboard card
   * GET /api/v1/fleet/status-summary
   */
  static getStatusSummary = catchAsyncHandler(async (req, res) => {
    const result = await FleetService.getStatusSummary(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get fleet utilization dataset
   * GET /api/v1/fleet/utilization
   */
  static getUtilization = catchAsyncHandler(async (req, res) => {
    const result = await FleetService.getUtilization(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

module.exports = FleetController;


