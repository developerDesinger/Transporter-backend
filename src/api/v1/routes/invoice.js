const express = require("express");
const router = express.Router();
const InvoiceController = require("../controller/InvoiceController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

// All routes require authentication
router.use(isAuthenticated);

// GET /api/v1/invoices - Get all invoices
router.get(
  "/",
  requirePermission("invoices.view"),
  InvoiceController.getAllInvoices
);

// POST /api/v1/invoices/build - Build invoices from completed jobs
router.post(
  "/build",
  requirePermission("invoices.create"),
  InvoiceController.buildInvoices
);

// Invoice Builder endpoints
// GET /api/v1/invoices/groups - Get invoice groups
router.get(
  "/groups",
  requirePermission("operations.invoicing.view"),
  InvoiceController.getInvoiceGroups
);

// GET /api/v1/invoices/available-jobs - Get available jobs
router.get(
  "/available-jobs",
  requirePermission("operations.invoicing.view"),
  InvoiceController.getAvailableJobs
);

// POST /api/v1/invoices/group-jobs - Group jobs
router.post(
  "/group-jobs",
  requirePermission("operations.invoicing.create"),
  InvoiceController.groupJobs
);

// DELETE /api/v1/invoices/groups/:groupId/jobs/:jobId - Remove job from group
router.delete(
  "/groups/:groupId/jobs/:jobId",
  requirePermission("operations.invoicing.update"),
  InvoiceController.removeJobFromGroup
);

// POST /api/v1/invoices/groups/:groupId/mark-ready - Mark group as ready
router.post(
  "/groups/:groupId/mark-ready",
  requirePermission("operations.invoicing.update"),
  InvoiceController.markGroupAsReady
);

// POST /api/v1/invoices/create-from-groups - Create invoices from ready groups
router.post(
  "/create-from-groups",
  requirePermission("operations.invoicing.create"),
  InvoiceController.createInvoicesFromGroups
);

// POST /api/v1/invoices/manual - Create manual invoice
router.post(
  "/manual",
  requirePermission("operations.invoicing.create"),
  InvoiceController.createManualInvoice
);

// POST /api/v1/invoices/:invoiceId/send - Send invoice email
router.post(
  "/:invoiceId/send",
  requirePermission("financials.invoicing.send"),
  InvoiceController.sendInvoice
);

module.exports = router;

