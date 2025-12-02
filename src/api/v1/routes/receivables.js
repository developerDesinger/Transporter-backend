const express = require("express");
const router = express.Router();
const InvoiceController = require("../controller/InvoiceController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

// All routes require authentication
router.use(isAuthenticated);

// GET /api/v1/receivables/summary - Get receivables summary
router.get(
  "/summary",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesSummary
);

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

// POST /api/v1/receivables/payments - Record a new payment
router.post(
  "/payments",
  requirePermission("financials.receivables.manage"),
  InvoiceController.createReceivablesPayment
);

// GET /api/v1/receivables/batches - Get receivables batches
router.get(
  "/batches",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesBatches
);

// GET /api/v1/receivables/anomalies - Get receivables anomalies
router.get(
  "/anomalies",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesAnomalies
);

// GET /api/v1/receivables/anomalies/:paymentNo - Get anomaly details
router.get(
  "/anomalies/:paymentNo",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesAnomalyDetails
);

// GET /api/v1/receivables/statements - Get receivables statements
router.get(
  "/statements",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesStatements
);

// GET /api/v1/receivables/statements/:statementNo - Get statement details
router.get(
  "/statements/:statementNo",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesStatementDetails
);

// POST /api/v1/receivables/statements/create - Create and send statement
router.post(
  "/statements/create",
  requirePermission("financials.receivables.manage"),
  InvoiceController.createReceivablesStatement
);

// GET /api/v1/receivables/schedules - Get receivables schedules
router.get(
  "/schedules",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesSchedules
);

// POST /api/v1/receivables/schedules - Create receivables schedule
router.post(
  "/schedules",
  requirePermission("financials.receivables.manage"),
  InvoiceController.createReceivablesSchedule
);

// PUT /api/v1/receivables/schedules/:scheduleId - Update receivables schedule
router.put(
  "/schedules/:scheduleId",
  requirePermission("financials.receivables.manage"),
  InvoiceController.updateReceivablesSchedule
);

// DELETE /api/v1/receivables/schedules/:scheduleId - Delete receivables schedule
router.delete(
  "/schedules/:scheduleId",
  requirePermission("financials.receivables.manage"),
  InvoiceController.deleteReceivablesSchedule
);

// GET /api/v1/receivables/customer-activity - Get customer activity
router.get(
  "/customer-activity",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesCustomerActivity
);

// GET /api/v1/receivables/aging-report - Get aging report
router.get(
  "/aging-report",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesAgingReport
);

// GET /api/v1/receivables/calendar - Get receivables calendar
router.get(
  "/calendar",
  requirePermission("financials.receivables.view"),
  InvoiceController.getReceivablesCalendar
);

module.exports = router;

