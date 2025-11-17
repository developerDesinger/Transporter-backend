const express = require("express");
const router = express.Router();
const ReportController = require("../controller/ReportController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/reports/customer-churn
 * @desc    Get customer churn report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/customer-churn",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getCustomerChurnReport
);

/**
 * @route   GET /api/v1/reports/banned-entities
 * @desc    Get banned entities report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/banned-entities",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getBannedEntitiesReport
);

/**
 * @route   GET /api/v1/reports/invoices
 * @desc    Get invoices report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/invoices",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getInvoicesReport
);

/**
 * @route   GET /api/v1/reports/pay-runs
 * @desc    Get pay runs report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/pay-runs",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getPayRunsReport
);

/**
 * @route   GET /api/v1/reports/margins
 * @desc    Get margins report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/margins",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getMarginsReport
);

/**
 * @route   GET /api/v1/reports/jobs
 * @desc    Get jobs report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/jobs",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getJobsReport
);

/**
 * @route   GET /api/v1/reports/driver-hours
 * @desc    Get driver hours report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/driver-hours",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getDriverHoursReport
);

/**
 * @route   GET /api/v1/reports/fatigue
 * @desc    Get fatigue report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/fatigue",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getFatigueReport
);

/**
 * @route   GET /api/v1/reports/open-jobs
 * @desc    Get open jobs report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/open-jobs",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getOpenJobsReport
);

/**
 * @route   GET /api/v1/reports/top-performers
 * @desc    Get top performers report
 * @access  Authenticated (requires operations.reports.view permission)
 */
router.get(
  "/top-performers",
  isAuthenticated,
  requirePermission("operations.reports.view"),
  ReportController.getTopPerformersReport
);

/**
 * @route   GET /api/v1/reports/revenue-overview
 * @desc    Get revenue overview report (weekly)
 * @access  Authenticated (requires financials.reports.view permission)
 */
router.get(
  "/revenue-overview",
  isAuthenticated,
  requirePermission("financials.reports.view"),
  ReportController.getRevenueOverview
);

/**
 * @route   GET /api/v1/reports/export
 * @desc    Export report data (CSV, Excel, PDF)
 * @access  Authenticated (requires operations.reports.export permission)
 */
router.get(
  "/export",
  isAuthenticated,
  requirePermission("operations.reports.export"),
  ReportController.exportReport
);

module.exports = router;

