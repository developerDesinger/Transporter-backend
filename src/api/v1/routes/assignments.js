const express = require("express");
const router = express.Router();
const AssignmentController = require("../controller/AssignmentController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   PATCH /api/v1/assignments/:id
 * @desc    Update assignment details (startTime, finishTime, breakMinutes)
 * @access  Authenticated (requires operations.jobs.manage permission)
 */
router.patch(
  "/:id",
  isAuthenticated,
  requirePermission("operations.jobs.manage"),
  AssignmentController.updateAssignment
);

/**
 * @route   POST /api/v1/assignments/:id/request-paperwork-sms
 * @desc    Request paperwork SMS for an assignment
 * @access  Authenticated (requires operations.jobs.manage permission)
 */
router.post(
  "/:id/request-paperwork-sms",
  isAuthenticated,
  requirePermission("operations.jobs.manage"),
  AssignmentController.requestPaperworkSms
);

module.exports = router;

