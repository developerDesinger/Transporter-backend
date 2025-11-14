const express = require("express");
const router = express.Router();
const JobController = require("../controller/JobController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/jobs?date=YYYY-MM-DD
 * @desc    Get jobs for a specific service date
 * @access  Authenticated (requires operations.jobs.view permission)
 */
router.get(
  "/",
  isAuthenticated,
  requirePermission("operations.jobs.view"),
  JobController.getJobs
);

/**
 * @route   POST /api/v1/jobs
 * @desc    Create a new job
 * @access  Authenticated (requires operations.jobs.create permission)
 */
router.post(
  "/",
  isAuthenticated,
  requirePermission("operations.jobs.create"),
  JobController.createJob
);

/**
 * @route   GET /api/v1/jobs/close-view
 * @desc    Get jobs for close view with filtering
 * @access  Authenticated (requires operations.jobs.view permission)
 * @warning This route MUST be defined BEFORE any parameterized routes (e.g., /:id)
 *          to prevent "close-view" from being matched as an :id parameter
 */
router.get(
  "/close-view",
  isAuthenticated,
  requirePermission("operations.jobs.view"),
  JobController.getCloseViewJobs
);

/**
 * @route   POST /api/v1/jobs/:id/assign
 * @desc    Assign a driver to a job
 * @access  Authenticated (requires operations.jobs.manage permission)
 */
router.post(
  "/:id/assign",
  isAuthenticated,
  requirePermission("operations.jobs.manage"),
  JobController.assignDriver
);

/**
 * @route   POST /api/v1/jobs/:id/close
 * @desc    Close a job and create AR/AP entries
 * @access  Authenticated (requires operations.jobs.manage permission)
 */
router.post(
  "/:id/close",
  isAuthenticated,
  requirePermission("operations.jobs.manage"),
  JobController.closeJob
);

module.exports = router;

