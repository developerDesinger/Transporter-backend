const express = require("express");
const router = express.Router();
const AdjustmentController = require("../controller/AdjustmentController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

// All routes require authentication
router.use(isAuthenticated);

// GET /api/v1/adjustments/summary - Get adjustments summary
router.get(
  "/summary",
  requirePermission("financials.adjustments.view"),
  AdjustmentController.getSummary
);

// GET /api/v1/adjustments - Get list of adjustments
router.get(
  "/",
  requirePermission("financials.adjustments.view"),
  AdjustmentController.getAdjustments
);

// POST /api/v1/adjustments - Create a new adjustment
router.post(
  "/",
  requirePermission("financials.adjustments.manage"),
  AdjustmentController.createAdjustment
);

// POST /api/v1/adjustments/:id/send - Send adjustment
router.post(
  "/:id/send",
  requirePermission("financials.adjustments.manage"),
  AdjustmentController.sendAdjustment
);

// POST /api/v1/adjustments/:id/resend - Resend adjustment
router.post(
  "/:id/resend",
  requirePermission("financials.adjustments.manage"),
  AdjustmentController.resendAdjustment
);

// POST /api/v1/adjustments/:id/approve - Approve adjustment
router.post(
  "/:id/approve",
  requirePermission("financials.adjustments.approve"), // Assuming separate permission for approval
  AdjustmentController.approveAdjustment
);

// POST /api/v1/adjustments/:id/apply - Apply adjustment
router.post(
  "/:id/apply",
  requirePermission("financials.adjustments.manage"),
  AdjustmentController.applyAdjustment
);

// GET /api/v1/adjustments/:id/pdf - Download adjustment PDF
router.get(
  "/:id/pdf",
  requirePermission("financials.adjustments.view"),
  AdjustmentController.downloadAdjustmentPDF
);

// GET /api/v1/adjustments/:id - Get adjustment details
router.get(
  "/:id",
  requirePermission("financials.adjustments.view"),
  AdjustmentController.getAdjustmentDetails
);

// PUT /api/v1/adjustments/:id - Update adjustment
router.put(
  "/:id",
  requirePermission("financials.adjustments.manage"),
  AdjustmentController.updateAdjustment
);

// DELETE /api/v1/adjustments/:id - Delete adjustment
router.delete(
  "/:id",
  requirePermission("financials.adjustments.manage"),
  AdjustmentController.deleteAdjustment
);

module.exports = router;

