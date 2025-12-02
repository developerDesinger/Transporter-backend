const DashboardService = require("../services/dashboard.service");
const MasterDataService = require("../services/masterData.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class DashboardController {
  /**
   * Get dashboard statistics
   * GET /api/v1/dashboard/stats
   */
  static getDashboardStats = catchAsyncHandler(async (req, res) => {
    const user = req.user;

    // Check permissions according to guide
    const hasAccess = checkDashboardAccess(user);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    const stats = await DashboardService.getDashboardStats(user);
    return res.status(200).json(stats);
  });

  /**
   * Get today's jobs
   * GET /api/v1/dashboard/today-jobs
   */
  static getTodayJobs = catchAsyncHandler(async (req, res) => {
    const user = req.user;

    // Check permissions according to guide
    const hasAccess = checkDashboardAccess(user);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    const jobs = await DashboardService.getTodayJobs(user);
    return res.status(200).json(jobs);
  });

  /**
   * Get active drivers
   * GET /api/v1/dashboard/active-drivers
   */
  static getActiveDrivers = catchAsyncHandler(async (req, res) => {
    const user = req.user;

    // Check permissions according to guide
    const hasAccess = checkDashboardAccess(user);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    const drivers = await DashboardService.getActiveDrivers(user);
    return res.status(200).json(drivers);
  });

  /**
   * Get active jobs list for dashboard
   * GET /api/v1/dashboard/active-jobs
   */
  static getActiveJobs = catchAsyncHandler(async (req, res) => {
    const user = req.user;
    const hasAccess = checkDashboardAccess(user);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    const result = await DashboardService.getActiveJobs(req.query, user);
    return res.status(200).json({
      success: true,
      data: result.data,
      summary: result.summary,
    });
  });

  /**
   * Get recent activity events
   * GET /api/v1/dashboard/activity
   */
  static getRecentActivity = catchAsyncHandler(async (req, res) => {
    const user = req.user;
    const hasAccess = checkDashboardAccess(user);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    const result = await DashboardService.getRecentActivity(req.query, user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

/**
 * Check if user has dashboard access
 * Based on guide requirements: SUPER_ADMIN, TENANT_ADMIN, or operations.dashboard.view permission
 */
function checkDashboardAccess(user) {
  if (!user) return false;

  // Super admin has all permissions
  if (user.role === "SUPER_ADMIN" || user.isSuperAdmin === true) {
    return true;
  }

  // Tenant admin has access within their organization
  if (user.currentOrgRole === "TENANT_ADMIN") {
    return true;
  }

  // Check organizations array
  if (user.activeOrganizationId && user.organizations) {
    const activeOrg = user.organizations.find(
      (org) => org.id && org.id.toString() === user.activeOrganizationId.toString()
    );
    if (activeOrg?.orgRole === "TENANT_ADMIN") {
      return true;
    }
  }

  // Check for explicit permission
  const permissions = user.permissions || [];
  if (permissions.includes("operations.dashboard.view")) {
    return true;
  }

  // Check role-based permissions
  const rolePermissions = {
    ADMIN: ["operations.dashboard.view"],
    OPERATIONS: ["operations.dashboard.view"],
    FINANCE: ["operations.dashboard.view"],
  };

  if (rolePermissions[user.role]) {
    return rolePermissions[user.role].includes("operations.dashboard.view");
  }

  return false;
}

module.exports = DashboardController;

