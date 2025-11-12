const express = require("express");
const router = express.Router();
const PayRunController = require("../controller/PayRunController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

// All routes require authentication
router.use(isAuthenticated);

// GET /api/v1/pay-runs - Get all pay runs
router.get(
  "/",
  requirePermission("payruns.view"),
  PayRunController.getAllPayRuns
);

// GET /api/v1/pay-runs/:id/drivers - Get all drivers in a pay run
router.get(
  "/:id/drivers",
  requirePermission("payruns.view"),
  PayRunController.getPayRunDrivers
);

// GET /api/v1/pay-runs/:id/items - Get all items in a pay run
router.get(
  "/:id/items",
  requirePermission("payruns.view"),
  PayRunController.getPayRunItems
);

// POST /api/v1/pay-runs/:id/rebuild - Rebuild a pay run (re-query eligibility, preserve exclusions)
// Must come before /:id route to avoid conflicts
router.post(
  "/:id/rebuild",
  requirePermission("payruns.manage"),
  PayRunController.rebuildPayRun
);

// POST /api/v1/pay-runs/:id/post - Post a pay run (finalize it)
// Must come before /:id route to avoid conflicts
router.post(
  "/:id/post",
  requirePermission("payruns.manage"),
  PayRunController.postPayRun
);

// GET /api/v1/pay-runs/:id - Get pay run detail by ID
router.get(
  "/:id",
  requirePermission("payruns.view"),
  PayRunController.getPayRunById
);

// POST /api/v1/pay-runs/build - Build a new pay run
router.post(
  "/build",
  requirePermission("payruns.create"),
  PayRunController.buildPayRun
);

module.exports = router;

