const express = require("express");
const router = express.Router();
const FleetController = require("../controller/FleetController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/fleet/status-summary
 * @desc    Get fleet status summary for dashboard card
 * @access  Authenticated (requires operations.fleet.view permission)
 */
router.get(
  "/status-summary",
  isAuthenticated,
  requirePermission("operations.fleet.view"),
  FleetController.getStatusSummary
);

/**
 * @route   GET /api/v1/fleet/utilization
 * @desc    Get fleet utilization dataset for dashboard
 * @access  Authenticated (requires operations.fleet.view permission)
 */
router.get(
  "/utilization",
  isAuthenticated,
  requirePermission("operations.fleet.view"),
  FleetController.getUtilization
);

module.exports = router;


