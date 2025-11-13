const express = require("express");
const router = express.Router();
const JobController = require("../controller/JobController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

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

module.exports = router;

