const express = require("express");
const router = express.Router();
const ScheduleController = require("../controller/ScheduleController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/schedule/upcoming
 * @desc    Get upcoming schedule (next N hours)
 * @access  Authenticated (requires operations.schedule.view permission)
 */
router.get(
  "/upcoming",
  isAuthenticated,
  requirePermission("operations.schedule.view"),
  ScheduleController.getUpcomingSchedule
);

module.exports = router;


