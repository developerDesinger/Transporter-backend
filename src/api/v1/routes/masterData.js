const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const MasterDataController = require("../controller/MasterDataController");
const BroadcastController = require("../controller/BroadcastController");
const { isAuthenticated } = require("../middlewares/auth.middleware");
const { requirePermission, requireAnyPermission } = require("../middlewares/permission.middleware");

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

// Configure multer for customer document uploads (disk storage)
const customerDocumentStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const customerId = req.params.id;
    const uploadDir = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      "customers",
      customerId
    );

    // Create directory if it doesn't exist
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (error) {
      console.error("Error creating upload directory:", error);
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: originalname_timestamp.extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}_${uniqueSuffix}${ext}`);
  },
});

const customerDocumentUpload = multer({
  storage: customerDocumentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow PDF, images, and common document types
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only PDF, images, and document files are allowed."
        ),
        false
      );
    }
  },
});

// Configure multer for generic file uploads (disk storage)
const genericUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Determine upload directory based on context (default: drivers)
    const context = req.body.context || "drivers";
    const uploadDir = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      context
    );

    // Create directory if it doesn't exist
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (error) {
      console.error("Error creating upload directory:", error);
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: originalname_timestamp.extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}_${uniqueSuffix}${ext}`);
  },
});

const genericUpload = multer({
  storage: genericUploadStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow PDF, images, and common document types
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only PDF, images, and document files are allowed."
        ),
        false
      );
    }
  },
});

// Configure multer for driver document uploads (disk storage)
const driverDocumentStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const driverId = req.body.driverId || "temp";
    const uploadDir = path.join(
      process.env.UPLOAD_DIR || "./uploads",
      "drivers",
      driverId
    );

    // Create directory if it doesn't exist
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (error) {
      console.error("Error creating upload directory:", error);
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: originalname_timestamp.extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}_${uniqueSuffix}${ext}`);
  },
});

const driverDocumentUpload = multer({
  storage: driverDocumentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow PDF, images, and common document types
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only PDF, images, and document files are allowed."
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
  "/tms-drivers",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getTmsDrivers
);

router.get(
  "/drivers",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getAllDrivers
);

// GET /api/v1/drivers/broadcast - Get drivers for broadcast
router.get(
  "/drivers/broadcast",
  isAuthenticated,
  requirePermission("operations.broadcasts.view"),
  BroadcastController.getDriversForBroadcast
);

router.get(
  "/drivers/:id",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getDriverById
);

router.patch(
  "/drivers/:id/approve-induction",
  isAuthenticated,
  requirePermission("drivers.manage"),
  MasterDataController.approveDriverInduction
);

router.post(
  "/drivers/sync-user-link/:userId",
  isAuthenticated,
  requirePermission("drivers.manage"),
  MasterDataController.syncDriverUserLink
);

router.post(
  "/drivers",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createDriver
);

router.patch(
  "/drivers/:id/status",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.toggleDriverStatus
);

router.patch(
  "/drivers/:id",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateDriver
);

// ==================== DRIVER RATES ====================
router.get(
  "/drivers/:id/rates",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getDriverRates
);

router.post(
  "/drivers/:id/rates",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createDriverRate
);

router.patch(
  "/drivers/:id/rates/:rateId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateDriverRate
);

router.delete(
  "/drivers/:id/rates/:rateId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deleteDriverRate
);

// ==================== DRIVER LINKED DOCUMENTS ====================
router.get(
  "/drivers/:id/linked-documents",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getDriverLinkedDocuments
);

router.post(
  "/drivers/:id/linked-documents",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.linkDocumentTemplateToDriver
);

router.patch(
  "/linked-documents/:docId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateLinkedDocument
);

router.delete(
  "/linked-documents/:docId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deleteLinkedDocument
);

router.post(
  "/linked-documents/:docId/send",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.sendLinkedDocument
);


router.post(
  "/drivers/:id/rates/lock",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.lockDriverRates
);

router.post(
  "/drivers/:id/rates/unlock",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.unlockDriverRates
);

router.post(
  "/drivers/:id/rates/apply-cpi-increase",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.applyCPIToDriverRates
);

router.post(
  "/drivers/:id/copy-hourly-house-rates",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.copyHourlyHouseRates
);

router.post(
  "/drivers/:id/copy-ftl-house-rates",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.copyFtlHouseRates
);

router.patch(
  "/drivers/:id/fuel-levy",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateDriverFuelLevy
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

router.post(
  "/customers/:id/documents",
  isAuthenticated,
  requirePermission("master_data.manage"),
  (req, res, next) => {
    customerDocumentUpload.single("file")(req, res, (err) => {
      if (err) {
        // Handle multer errors
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            message: "File size exceeds maximum allowed size of 10MB",
          });
        }
        if (err.message) {
          return res.status(400).json({ message: err.message });
        }
        return res.status(400).json({
          message: "File upload error",
        });
      }
      next();
    });
  },
  MasterDataController.uploadCustomerDocument
);

router.delete(
  "/customers/:id/documents/:documentId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deleteCustomerDocument
);

router.get(
  "/customers/:id/documents/:docId/download",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.downloadCustomerDocument
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
  "/customers/:id/fuel-levy",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateCustomerFuelLevy
);

// ==================== CUSTOMER HOURLY RATES ====================
router.get(
  "/customers/:id/hourly-rates",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getCustomerHourlyRates
);

router.post(
  "/customers/:id/hourly-rates",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createCustomerHourlyRate
);

router.patch(
  "/customers/:id/hourly-rates/:rateId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updateCustomerHourlyRate
);

router.delete(
  "/customers/:id/hourly-rates/:rateId",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deleteCustomerHourlyRate
);

// ==================== CUSTOMER FTL RATES ====================
router.get(
  "/customers/:id/ftl-rates",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getCustomerFtlRates
);

router.post(
  "/customers/:id/ftl-rates",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createCustomerFtlRate
);

// ==================== CUSTOMER ONBOARDING ====================
router.post(
  "/customers/:id/send-onboarding",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.sendCustomerOnboarding
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

// ==================== FTL HOUSE RATES ====================
router.get(
  "/ftl-house-rates",
  requirePermission("master_data.view"),
  MasterDataController.getFtlHouseRates
);

router.patch(
  "/ftl-house-rates/:id",
  requirePermission("master_data.manage"),
  MasterDataController.updateFtlHouseRate
);

router.delete(
  "/ftl-house-rates/:id",
  requirePermission("master_data.manage"),
  MasterDataController.deleteFtlHouseRate
);

router.post(
  "/ftl-house-rates/upload",
  requirePermission("master_data.manage"),
  csvUpload.single("file"),
  MasterDataController.uploadFtlHouseRates
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
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getAllVehicleTypes
);

// ==================== HOURLY HOUSE RATES ====================
router.get(
  "/hourly-house-rates",
  isAuthenticated,
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

// ==================== FTL HOUSE RATES ====================
router.get(
  "/ftl-house-rates",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getFtlHouseRates
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

// ==================== RCTI LOGS ====================
router.get(
  "/rcti-logs",
  isAuthenticated,
  requireAnyPermission("drivers.view", "master_data.view"),
  MasterDataController.getRCTILogs
);

router.post(
  "/payruns/:payRunId/send-rctis",
  isAuthenticated,
  requireAnyPermission("drivers.manage", "master_data.manage"),
  MasterDataController.sendRCTIs
);

// Vehicle routes
// Note: General routes must come before parameterized routes
router.get(
  "/vehicles",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getAllVehicles
);

router.post(
  "/vehicles",
  isAuthenticated,
  requirePermission("vehicles.create"),
  MasterDataController.createVehicle
);

// More specific routes must come before less specific routes
router.get(
  "/vehicles/:id/maintenance-logs",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getMaintenanceLogs
);

router.post(
  "/vehicles/:id/maintenance-logs",
  isAuthenticated,
  requirePermission("vehicles.manage"),
  MasterDataController.createMaintenanceLog
);

router.get(
  "/vehicles/:id/history",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getVehicleHistory
);

router.get(
  "/vehicles/:id",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getVehicleById
);

// Vehicle Profile Actions routes
// GET routes (must come before POST routes to avoid conflicts)
router.get(
  "/inspections",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getInspections
);

router.get(
  "/defects",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getDefects
);

router.get(
  "/work-orders",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getWorkOrders
);

router.get(
  "/schedules",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getSchedules
);

router.get(
  "/documents",
  isAuthenticated,
  requirePermission("vehicles.view"),
  MasterDataController.getVehicleDocuments
);

// POST routes
router.post(
  "/inspections",
  isAuthenticated,
  requirePermission("vehicles.manage"),
  MasterDataController.createInspection
);

router.post(
  "/defects",
  isAuthenticated,
  requirePermission("vehicles.manage"),
  MasterDataController.createDefect
);

router.post(
  "/work-orders",
  isAuthenticated,
  requirePermission("vehicles.manage"),
  MasterDataController.createWorkOrder
);

router.post(
  "/schedules",
  isAuthenticated,
  requirePermission("vehicles.manage"),
  MasterDataController.createSchedule
);

router.post(
  "/documents",
  isAuthenticated,
  requirePermission("vehicles.manage"),
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }).single("file"),
  MasterDataController.uploadVehicleDocument
);

// Permanent Assignments routes
router.get(
  "/permanent-assignments",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getAllPermanentAssignments
);

router.post(
  "/permanent-assignments",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createPermanentAssignment
);

router.patch(
  "/permanent-assignments/:id",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updatePermanentAssignment
);

router.delete(
  "/permanent-assignments/:id",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deletePermanentAssignment
);

// Permanent Jobs routes
router.get(
  "/permanent-jobs",
  isAuthenticated,
  requirePermission("master_data.view"),
  MasterDataController.getAllPermanentJobs
);

router.post(
  "/permanent-jobs",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.createPermanentJob
);

router.patch(
  "/permanent-jobs/:id",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.updatePermanentJob
);

router.delete(
  "/permanent-jobs/:id",
  isAuthenticated,
  requirePermission("master_data.manage"),
  MasterDataController.deletePermanentJob
);

// All master data routes require authentication and permission
router.use(isAuthenticated);

module.exports = router;

