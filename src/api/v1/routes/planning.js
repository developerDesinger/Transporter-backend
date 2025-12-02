const express = require("express");
const router = express.Router();
const PlanningController = require("../controller/PlanningController");
const DailyNotesController = require("../controller/DailyNotesController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

/**
 * @route   GET /api/v1/planning-sheet
 * @desc    Get planning sheet for a specific date
 * @access  Authenticated (requires operations.planning.view permission)
 */
router.get(
  "/planning-sheet",
  isAuthenticated,
  requirePermission("operations.planning.view"),
  PlanningController.getPlanningSheet
);

/**
 * @route   POST /api/v1/planning-sheet
 * @desc    Save planning sheet for a specific date
 * @access  Authenticated (requires operations.planning.manage permission)
 */
router.post(
  "/planning-sheet",
  isAuthenticated,
  requirePermission("operations.planning.manage"),
  PlanningController.savePlanningSheet
);

/**
 * @route   DELETE /api/v1/planning-sheet/rows/:rowId
 * @desc    Delete a planning sheet row
 * @access  Authenticated (requires operations.planning.manage permission)
 */
router.delete(
  "/planning-sheet/rows/:rowId",
  isAuthenticated,
  requirePermission("operations.planning.manage"),
  PlanningController.deletePlanningRow
);

/**
 * @route   DELETE /api/v1/planning-sheet/columns/:columnKey
 * @desc    Delete a planning sheet column
 * @access  Authenticated (requires operations.planning.manage permission)
 */
router.delete(
  "/planning-sheet/columns/:columnKey",
  isAuthenticated,
  requirePermission("operations.planning.manage"),
  PlanningController.deletePlanningColumn
);

/**
 * @route   GET /api/v1/daily-notes
 * @desc    Get daily notes for a specific date
 * @access  Authenticated (requires operations.planning.view permission)
 */
router.get(
  "/daily-notes",
  isAuthenticated,
  requirePermission("operations.planning.view"),
  DailyNotesController.getDailyNotes
);

/**
 * @route   POST /api/v1/daily-notes
 * @desc    Save daily notes for a specific date
 * @access  Authenticated (requires operations.planning.manage permission)
 */
router.post(
  "/daily-notes",
  isAuthenticated,
  requirePermission("operations.planning.manage"),
  DailyNotesController.saveDailyNotes
);

module.exports = router;

