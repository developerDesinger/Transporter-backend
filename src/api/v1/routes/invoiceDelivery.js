const express = require("express");
const router = express.Router();
const InvoiceDeliveryController = require("../controller/InvoiceDeliveryController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

// Webhook (no auth - secured via shared secret header)
router.post("/webhook", InvoiceDeliveryController.handleWebhook);

router.use(isAuthenticated);

router.get(
  "/summary",
  requirePermission("financials.invoicing.view"),
  InvoiceDeliveryController.getSummary
);

router.get(
  "/",
  requirePermission("financials.invoicing.view"),
  InvoiceDeliveryController.getDeliveries
);

router.get(
  "/:deliveryId",
  requirePermission("financials.invoicing.view"),
  InvoiceDeliveryController.getDeliveryDetail
);

router.post(
  "/:deliveryId/resend",
  requirePermission("financials.invoicing.send"),
  InvoiceDeliveryController.resendInvoice
);

module.exports = router;

