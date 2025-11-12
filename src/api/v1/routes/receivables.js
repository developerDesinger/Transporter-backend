const express = require("express");
const router = express.Router();
const InvoiceController = require("../controller/InvoiceController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

// All routes require authentication
router.use(isAuthenticated);

// GET /api/v1/receivables/invoices - Get receivables invoices
router.get(
  "/invoices",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesInvoices
);

// POST /api/v1/receivables/invoices - Create a new receivables invoice
router.post(
  "/invoices",
  requirePermission("financials.receivables.manage"),
  InvoiceController.createReceivablesInvoice
);

// POST /api/v1/receivables/invoices/:id/quick-pay - Quick pay an invoice
router.post(
  "/invoices/:id/quick-pay",
  requirePermission("financials.receivables.manage"),
  InvoiceController.quickPayInvoice
);

// GET /api/v1/receivables/payments - Get receivables payments
router.get(
  "/payments",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesPayments
);

module.exports = router;

