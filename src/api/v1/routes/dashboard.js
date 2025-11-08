const express = require("express");
const router = express.Router();
const DashboardController = require("../controller/DashboardController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/dashboard/stats
 * @desc    Get dashboard statistics (revenue, activeJobs, driversOnDuty)
 * @access  Authenticated (requires operations.dashboard.view permission or DRIVER role)
 */
router.get(
  "/stats",
  isAuthenticated,
  DashboardController.getDashboardStats
);

/**
 * @route   GET /api/v1/dashboard/today-jobs
 * @desc    Get today's jobs (filtered by assigned driver if user is DRIVER)
 * @access  Authenticated (requires operations.dashboard.view permission or DRIVER role)
 */
router.get(
  "/today-jobs",
  isAuthenticated,
  DashboardController.getTodayJobs
);

/**
 * @route   GET /api/v1/dashboard/active-drivers
 * @desc    Get list of active drivers currently on duty
 * @access  Authenticated (requires operations.dashboard.view permission)
 */
router.get(
  "/active-drivers",
  isAuthenticated,
  requirePermission("operations.dashboard.view"),
  DashboardController.getActiveDrivers
);

module.exports = router;

