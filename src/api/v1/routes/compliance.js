const express = require("express");
const router = express.Router();
const ComplianceController = require("../controller/ComplianceController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/compliance/alerts
 * @desc    Get compliance alerts for dashboard
 * @access  Authenticated (requires compliance.alerts.view permission)
 */
router.get(
  "/alerts",
  isAuthenticated,
  requirePermission("compliance.alerts.view"),
  ComplianceController.getAlerts
);

module.exports = router;


