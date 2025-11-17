const ComplianceService = require("../services/compliance.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class ComplianceController {
  /**
   * Get compliance alerts for dashboard widget
   * GET /api/v1/compliance/alerts
   */
  static getAlerts = catchAsyncHandler(async (req, res) => {
    const result = await ComplianceService.getAlerts(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

module.exports = ComplianceController;


