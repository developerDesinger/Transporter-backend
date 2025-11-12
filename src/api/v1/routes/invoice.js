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

module.exports = router;

