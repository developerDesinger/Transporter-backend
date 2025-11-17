const express = require("express");
const router = express.Router();
const BroadcastController = require("../controller/BroadcastController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/client-broadcasts
 * @desc    Get client broadcast history
 * @access  Authenticated (requires operations.broadcasts.view permission)
 */
router.get(
  "/",
  isAuthenticated,
  requirePermission("operations.broadcasts.view"),
  BroadcastController.getClientBroadcasts
);

/**
 * @route   POST /api/v1/client-broadcasts/preview
 * @desc    Preview customers matching filter criteria for client broadcast
 * @access  Authenticated (requires operations.broadcasts.view permission)
 * @warning This route MUST be defined BEFORE the POST / route to prevent "preview" from being matched incorrectly
 */
router.post(
  "/preview",
  isAuthenticated,
  requirePermission("operations.broadcasts.view"),
  BroadcastController.previewClientBroadcast
);

/**
 * @route   POST /api/v1/client-broadcasts
 * @desc    Send client broadcast to customers matching filter criteria
 * @access  Authenticated (requires operations.broadcasts.manage permission)
 */
router.post(
  "/",
  isAuthenticated,
  requirePermission("operations.broadcasts.manage"),
  BroadcastController.sendClientBroadcast
);

module.exports = router;

