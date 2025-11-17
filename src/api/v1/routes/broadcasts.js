const express = require("express");
const router = express.Router();
const BroadcastController = require("../controller/BroadcastController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/broadcasts
 * @desc    Get broadcast history
 * @access  Authenticated (requires operations.broadcasts.view permission)
 */
router.get(
  "/",
  isAuthenticated,
  requirePermission("operations.broadcasts.view"),
  BroadcastController.getBroadcasts
);

/**
 * @route   POST /api/v1/broadcasts
 * @desc    Send broadcast to drivers matching filter criteria
 * @access  Authenticated (requires operations.broadcasts.manage permission)
 */
router.post(
  "/",
  isAuthenticated,
  requirePermission("operations.broadcasts.manage"),
  BroadcastController.sendBroadcast
);

/**
 * @route   GET /api/v1/broadcasts/vehicle-types
 * @desc    Get vehicle type codes for broadcast filtering
 * @access  Authenticated (requires operations.broadcasts.view permission)
 */
router.get(
  "/vehicle-types",
  isAuthenticated,
  requirePermission("operations.broadcasts.view"),
  BroadcastController.getVehicleTypes
);

/**
 * @route   POST /api/v1/broadcasts/preview
 * @desc    Preview drivers matching filter criteria for broadcast
 * @access  Authenticated (requires operations.broadcasts.view permission)
 */
router.post(
  "/preview",
  isAuthenticated,
  requirePermission("operations.broadcasts.view"),
  BroadcastController.previewBroadcast
);

module.exports = router;

