const express = require("express");
const router = express.Router();
const AllocatorController = require("../controller/AllocatorController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const multer = require("multer");

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// All routes require authentication
router.use(isAuthenticated);

// ==================== ALLOCATOR ROWS ====================

// GET /api/v1/allocator-rows/range - Get rows for date range
router.get(
  "/allocator-rows/range",
  requirePermission("operations.allocator.view"),
  AllocatorController.getRowsByRange
);

// POST /api/v1/allocator-rows - Create new row
router.post(
  "/allocator-rows",
  requirePermission("operations.allocator.manage"),
  AllocatorController.createRow
);

// PATCH /api/v1/allocator-rows/:id - Update row
router.patch(
  "/allocator-rows/:id",
  requirePermission("operations.allocator.manage"),
  AllocatorController.updateRow
);

// POST /api/v1/allocator-rows/:id/lock - Lock row and create job
router.post(
  "/allocator-rows/:id/lock",
  requirePermission("operations.allocator.manage"),
  AllocatorController.lockRow
);

// POST /api/v1/allocator-rows/:id/unlock - Unlock row
router.post(
  "/allocator-rows/:id/unlock",
  requirePermission("operations.allocator.manage"),
  AllocatorController.unlockRow
);

// POST /api/v1/allocator-rows/lock-batch - Lock multiple rows
router.post(
  "/allocator-rows/lock-batch",
  requirePermission("operations.allocator.manage"),
  AllocatorController.lockBatch
);

// POST /api/v1/allocator-rows/unlock-batch - Unlock multiple rows
router.post(
  "/allocator-rows/unlock-batch",
  requirePermission("operations.allocator.manage"),
  AllocatorController.unlockBatch
);

// POST /api/v1/allocator-rows/delete-batch - Delete multiple rows
router.post(
  "/allocator-rows/delete-batch",
  requirePermission("operations.allocator.manage"),
  AllocatorController.deleteBatch
);

// ==================== MASTER DATA ====================

// GET /api/v1/eligible-customers - Get eligible customers
router.get(
  "/eligible-customers",
  requirePermission("operations.allocator.view"),
  AllocatorController.getEligibleCustomers
);

// GET /api/v1/drivers - Get all drivers (for allocator)
router.get(
  "/drivers",
  requirePermission("operations.allocator.view"),
  AllocatorController.getAllDrivers
);

// GET /api/v1/vehicle-types - Get vehicle types
router.get(
  "/vehicle-types",
  requirePermission("operations.allocator.view"),
  AllocatorController.getVehicleTypes
);

// ==================== JOB MANAGEMENT ====================

// GET /api/v1/jobs/:id - Get job details
router.get(
  "/jobs/:id",
  requirePermission("operations.jobs.view"),
  AllocatorController.getJobById
);

// POST /api/v1/jobs/:id/send-to-driver - Send job notification
router.post(
  "/jobs/:id/send-to-driver",
  requirePermission("operations.jobs.manage"),
  AllocatorController.sendToDriver
);

// ==================== ATTACHMENTS ====================

// GET /api/v1/allocator-rows/:id/attachments - Get attachments
router.get(
  "/allocator-rows/:id/attachments",
  requirePermission("operations.allocator.view"),
  AllocatorController.getAttachments
);

// POST /api/v1/allocator-rows/:id/attachments - Upload attachment
router.post(
  "/allocator-rows/:id/attachments",
  requirePermission("operations.allocator.manage"),
  upload.single("file"),
  AllocatorController.uploadAttachment
);

// DELETE /api/v1/attachments/:id - Delete attachment
router.delete(
  "/attachments/:id",
  requirePermission("operations.allocator.manage"),
  AllocatorController.deleteAttachment
);

// ==================== USER PREFERENCES ====================

// GET /api/v1/allocator-preferences/:boardType - Get preferences
router.get(
  "/allocator-preferences/:boardType",
  requirePermission("operations.allocator.view"),
  AllocatorController.getPreferences
);

// POST /api/v1/allocator-preferences/:boardType - Save preferences
router.post(
  "/allocator-preferences/:boardType",
  requirePermission("operations.allocator.view"),
  AllocatorController.savePreferences
);

// ==================== ANCILLARIES ====================

// GET /api/v1/ancillaries - Get all ancillaries
router.get(
  "/ancillaries",
  requirePermission("operations.allocator.view"),
  AllocatorController.getAncillaries
);

// GET /api/v1/customers/:id/rate-cards - Get customer rate cards
router.get(
  "/customers/:id/rate-cards",
  requirePermission("operations.allocator.view"),
  AllocatorController.getCustomerRateCards
);

// GET /api/v1/customer-rate-cards/:id/ancillary-lines - Get ancillary lines
router.get(
  "/customer-rate-cards/:id/ancillary-lines",
  requirePermission("operations.allocator.view"),
  AllocatorController.getRateCardAncillaryLines
);

// ==================== DRIVER USAGE ====================

// POST /api/v1/driver-usage/track - Track driver usage
router.post(
  "/driver-usage/track",
  requirePermission("operations.allocator.manage"),
  AllocatorController.trackDriverUsage
);

// ==================== AVAILABILITY ====================

// GET /api/v1/availability - Get driver availability
router.get(
  "/availability",
  requirePermission("operations.allocator.view"),
  AllocatorController.getAvailability
);

// ==================== NOTIFICATIONS ====================

// POST /api/v1/assignments/:id/request-paperwork-sms - Request paperwork SMS
router.post(
  "/assignments/:id/request-paperwork-sms",
  requirePermission("operations.jobs.manage"),
  AllocatorController.requestPaperworkSms
);

module.exports = router;

