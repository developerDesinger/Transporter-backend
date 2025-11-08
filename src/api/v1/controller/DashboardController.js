const DashboardService = require("../services/dashboard.service");
const MasterDataService = require("../services/masterData.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class DashboardController {
  /**
   * Get dashboard statistics
   * GET /api/v1/dashboard/stats
   */
  static getDashboardStats = catchAsyncHandler(async (req, res) => {
    // Check if user has permission or is a driver
    const userRole = req.user.role;
    const hasPermission = req.user.permissions?.includes("operations.dashboard.view") || req.user.isSuperAdmin;

    // For drivers, check if they're approved
    if (userRole === "DRIVER") {
      const driverData = await MasterDataService.getAllDrivers({ userId: req.user.id }, req.user);

      if (!driverData || driverData.driverStatus !== "COMPLIANT" || !driverData.isActive) {
        return res.status(403).json({
          message: "Driver account not approved. Please complete your induction.",
          requiresApproval: true,
        });
      }
    } else if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const stats = await DashboardService.getDashboardStats(req.user);
    return res.status(200).json(stats);
  });

  /**
   * Get today's jobs
   * GET /api/v1/dashboard/today-jobs
   */
  static getTodayJobs = catchAsyncHandler(async (req, res) => {
    // Check if user has permission or is a driver
    const userRole = req.user.role;
    const hasPermission = req.user.permissions?.includes("operations.dashboard.view") || req.user.isSuperAdmin;

    // For drivers, check if they're approved
    if (userRole === "DRIVER") {
      const driverData = await MasterDataService.getAllDrivers({ userId: req.user.id }, req.user);

      if (!driverData || driverData.driverStatus !== "COMPLIANT" || !driverData.isActive) {
        return res.status(403).json({
          message: "Driver account not approved. Please complete your induction.",
          requiresApproval: true,
        });
      }
    } else if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const jobs = await DashboardService.getTodayJobs(req.user);
    return res.status(200).json(jobs);
  });

  /**
   * Get active drivers
   * GET /api/v1/dashboard/active-drivers
   */
  static getActiveDrivers = catchAsyncHandler(async (req, res) => {
    // Check if user has permission
    const hasPermission = req.user.permissions?.includes("operations.dashboard.view") || req.user.isSuperAdmin;

    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const drivers = await DashboardService.getActiveDrivers(req.user);
    return res.status(200).json(drivers);
  });
}

module.exports = DashboardController;

