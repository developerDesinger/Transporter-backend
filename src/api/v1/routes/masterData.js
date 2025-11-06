const express = require("express");
const multer = require("multer");
const MasterDataController = require("../controller/MasterDataController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

const router = express.Router();

// Configure multer for CSV uploads (memory storage)
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  },
});

// Configure multer for document uploads (PDF, JPG, PNG) - memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf("."));

    if (
      allowedMimes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF, JPG, JPEG, and PNG files are allowed for document uploads"
        ),
        false
      );
    }
  },
});

// Most master data routes require authentication and permission
// Exceptions: public routes (like driver induction) are defined before this middleware

// ==================== DRIVERS ====================
router.get(
  "/drivers",
  requirePermission("master_data.view"),
  MasterDataController.getAllDrivers
);

router.post(
  "/drivers",
  requirePermission("master_data.manage"),
  MasterDataController.createDriver
);

router.patch(
  "/drivers/:id/status",
  requirePermission("master_data.manage"),
  MasterDataController.toggleDriverStatus
);

router.patch(
  "/drivers/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateDriver
);

// ==================== DRIVER RATES ====================
router.get(
  "/drivers/:id/rates",
  requirePermission("master_data.view"),
  MasterDataController.getDriverRates
);

router.post(
  "/drivers/:id/rates",
  requirePermission("master_data.manage"),
  MasterDataController.createDriverRate
);

router.patch(
  "/drivers/:id/rates/:rateId",
  requirePermission("master_data.manage"),
  MasterDataController.updateDriverRate
);

router.delete(
  "/drivers/:id/rates/:rateId",
  requirePermission("master_data.manage"),
  MasterDataController.deleteDriverRate
);

router.post(
  "/drivers/:id/rates/lock",
  requirePermission("master_data.manage"),
  MasterDataController.lockDriverRates
);

router.post(
  "/drivers/:id/rates/unlock",
  requirePermission("master_data.manage"),
  MasterDataController.unlockDriverRates
);

router.post(
  "/drivers/:id/rates/apply-cpi-increase",
  requirePermission("master_data.manage"),
  MasterDataController.applyCPIToDriverRates
);

// ==================== CUSTOMERS ====================
router.get(
  "/customers",
  requirePermission("master_data.view"),
  MasterDataController.getAllCustomers
);

router.post(
  "/customers",
  requirePermission("master_data.manage"),
  MasterDataController.createCustomer
);

router.get(
  "/customers/:id",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getCustomerById
);

router.get(
  "/customers/:id/documents",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getCustomerDocuments
);

router.get(
  "/customers/:id/linked-documents",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getCustomerLinkedDocuments
);

// ==================== OPERATIONS CONTACTS ====================
router.get(
  "/customers/:id/operations-contacts",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getOperationsContacts
);

router.post(
  "/customers/:id/operations-contacts",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createOperationsContact
);

router.patch(
  "/customers/:id/operations-contacts/:contactId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateOperationsContact
);

router.delete(
  "/customers/:id/operations-contacts/:contactId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deleteOperationsContact
);

// ==================== BILLING CONTACTS ====================
router.get(
  "/customers/:id/billing-contacts",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getBillingContacts
);

router.post(
  "/customers/:id/billing-contacts",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createBillingContact
);

router.patch(
  "/customers/:id/billing-contacts/:contactId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateBillingContact
);

router.delete(
  "/customers/:id/billing-contacts/:contactId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deleteBillingContact
);

router.patch(
  "/customers/:id/status",
  requirePermission("master_data.manage"),
  MasterDataController.toggleCustomerStatus
);

router.patch(
  "/customers/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateCustomer
);

// ==================== RATE CARDS ====================
router.get(
  "/ratecards",
  requirePermission("master_data.view"),
  MasterDataController.getAllRateCards
);

router.post(
  "/ratecards",
  requirePermission("master_data.manage"),
  MasterDataController.createRateCard
);

router.patch(
  "/ratecards/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateRateCard
);

router.delete(
  "/ratecards/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteRateCard
);

router.post(
  "/ratecards/:id/lock",
  requirePermission("master_data.manage"),
  MasterDataController.lockRateCard
);

router.post(
  "/ratecards/:id/unlock",
  requirePermission("master_data.manage"),
  MasterDataController.unlockRateCard
);

router.post(
  "/ratecards/apply-cpi-increase",
  requirePermission("master_data.manage"),
  MasterDataController.applyCPIToRateCards
);

router.post(
  "/ratecards/upload",
  requirePermission("master_data.manage"),
  csvUpload.single("file"),
  MasterDataController.uploadRateCards
);

router.post(
  "/ratecards/copy-ftl-to-driver-pay",
  requirePermission("master_data.manage"),
  MasterDataController.copyFTLRatesToDriverPay
);

router.post(
  "/ratecards/copy-hourly-to-driver-pay",
  requirePermission("master_data.manage"),
  MasterDataController.copyHourlyRatesToDriverPay
);

// ==================== FUEL LEVIES ====================
router.get(
  "/fuel-levies",
  requirePermission("master_data.view"),
  MasterDataController.getAllFuelLevies
);

router.get(
  "/fuel-levies/current",
  requirePermission("master_data.view"),
  MasterDataController.getCurrentFuelLevy
);

router.get(
  "/fuel-levies/current/all",
  requirePermission("master_data.view"),
  MasterDataController.getCurrentFuelLevies
);

router.post(
  "/fuel-levies",
  requirePermission("master_data.manage"),
  MasterDataController.createFuelLevy
);

router.patch(
  "/fuel-levies/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateFuelLevy
);

// ==================== SERVICE CODES ====================
router.get(
  "/service-codes",
  requirePermission("master_data.view"),
  MasterDataController.getAllServiceCodes
);

router.post(
  "/service-codes",
  requirePermission("master_data.manage"),
  MasterDataController.createServiceCode
);

router.patch(
  "/service-codes/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateServiceCode
);

router.delete(
  "/service-codes/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteServiceCode
);

// ==================== ANCILLARIES ====================
router.get(
  "/ancillaries",
  requirePermission("master_data.view"),
  MasterDataController.getAllAncillaries
);

router.post(
  "/ancillaries",
  requirePermission("master_data.manage"),
  MasterDataController.createAncillary
);

router.patch(
  "/ancillaries/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateAncillary
);

router.delete(
  "/ancillaries/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteAncillary
);

// ==================== DOCUMENT TEMPLATES ====================
router.get(
  "/document-templates",
  requirePermission("master_data.view"),
  MasterDataController.getAllDocumentTemplates
);

router.post(
  "/document-templates",
  requirePermission("master_data.manage"),
  MasterDataController.createDocumentTemplate
);

router.patch(
  "/document-templates/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateDocumentTemplate
);

router.delete(
  "/document-templates/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteDocumentTemplate
);

// ==================== ZONES ====================
router.get(
  "/zone-master",
  requirePermission("master_data.view"),
  MasterDataController.getAllZones
);

router.post(
  "/zone-master",
  requirePermission("master_data.manage"),
  MasterDataController.createZone
);

router.patch(
  "/zone-master/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateZone
);

router.delete(
  "/zone-master/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteZone
);

// ==================== VEHICLE TYPES ====================
router.get(
  "/vehicle-types",
  requirePermission("master_data.view"),
  MasterDataController.getAllVehicleTypes
);

// ==================== HOURLY HOUSE RATES ====================
router.get(
  "/hourly-house-rates",
  requirePermission("master_data.view"),
  MasterDataController.getAllHourlyHouseRates
);

router.patch(
  "/hourly-house-rates/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateHourlyHouseRate
);

router.delete(
  "/hourly-house-rates/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteHourlyHouseRate
);

// ==================== INDUCTIONS (Driver Portal) ====================
router.get(
  "/inductions",
  isAuthenticated, // Public or authenticated
  MasterDataController.getAllInductions
);

router.get(
  "/drivers/:id/inductions",
  isAuthenticated,
  MasterDataController.getDriverInductions
);

router.post(
  "/drivers/:id/inductions",
  isAuthenticated,
  MasterDataController.completeDriverInduction
);

// All master data routes require authentication and permission
router.use(isAuthenticated);

module.exports = router;

