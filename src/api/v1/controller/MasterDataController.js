const MasterDataService = require("../services/masterData.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class MasterDataController {
  // ==================== DRIVERS ====================
  static getAllDrivers = catchAsyncHandler(async (req, res) => {
    const drivers = await MasterDataService.getAllDrivers(req.query, req.user);
    
    // If userId was provided and driver not found, return 404
    if (req.query.userId && !drivers) {
      return res.status(404).json({ message: "Driver not found" });
    }
    
    return res.status(200).json(drivers);
  });

  static getDriverById = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const driver = await MasterDataService.getDriverById(id);
    return res.status(200).json(driver);
  });

  static createDriver = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createDriver(req.body);
    return res.status(201).json(result);
  });

  static toggleDriverStatus = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const result = await MasterDataService.toggleDriverStatus(id, isActive);
    return res.status(200).json(result);
  });

  static updateDriver = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateDriver(id, req.body);
    return res.status(200).json(result);
  });

  // ==================== DRIVER RATES ====================
  static getDriverRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const rates = await MasterDataService.getDriverRates(id);
    return res.status(200).json(rates);
  });

  // ==================== DRIVER LINKED DOCUMENTS ====================
  static getDriverLinkedDocuments = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const linkedDocuments = await MasterDataService.getDriverLinkedDocuments(id);
    return res.status(200).json(linkedDocuments);
  });

  static linkDocumentTemplateToDriver = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.linkDocumentTemplateToDriver(id, req.body);
    return res.status(201).json(result);
  });

  static updateLinkedDocument = catchAsyncHandler(async (req, res) => {
    const { docId } = req.params;
    const result = await MasterDataService.updateLinkedDocument(docId, req.body);
    return res.status(200).json(result);
  });

  static deleteLinkedDocument = catchAsyncHandler(async (req, res) => {
    const { docId } = req.params;
    const result = await MasterDataService.deleteLinkedDocument(docId);
    return res.status(200).json(result);
  });

  static sendLinkedDocument = catchAsyncHandler(async (req, res) => {
    const { docId } = req.params;
    const result = await MasterDataService.sendLinkedDocument(docId, req.body);
    return res.status(200).json(result);
  });

  // ==================== DRIVER DOCUMENT UPLOAD ====================
  static uploadFile = catchAsyncHandler(async (req, res) => {
    const file = req.file;
    const result = await MasterDataService.uploadFile(file);
    return res.status(200).json(result);
  });

  static updateDriverDocument = catchAsyncHandler(async (req, res) => {
    const { driverId } = req.params;
    const result = await MasterDataService.updateDriverDocument(driverId, req.body);
    return res.status(200).json(result);
  });

  static uploadDriverDocument = catchAsyncHandler(async (req, res) => {
    const { driverId, policyType } = req.body;
    const file = req.file;

    try {
      const result = await MasterDataService.uploadDriverDocument(
        driverId,
        file,
        policyType
      );
      return res.status(200).json(result);
    } catch (error) {
      // Clean up uploaded file on error
      if (file && file.path) {
        const fs = require("fs").promises;
        try {
          await fs.unlink(file.path);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
      throw error;
    }
  });

  static createDriverRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.createDriverRate(id, req.body);
    return res.status(201).json(result);
  });

  static updateDriverRate = catchAsyncHandler(async (req, res) => {
    const { id, rateId } = req.params;
    const result = await MasterDataService.updateDriverRate(id, rateId, req.body);
    return res.status(200).json(result);
  });

  static deleteDriverRate = catchAsyncHandler(async (req, res) => {
    const { id, rateId } = req.params;
    const result = await MasterDataService.deleteDriverRate(id, rateId);
    return res.status(200).json(result);
  });

  static lockDriverRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.lockDriverRates(id);
    return res.status(200).json(result);
  });

  static unlockDriverRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.unlockDriverRates(id);
    return res.status(200).json(result);
  });

  static applyCPIToDriverRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { percentage, effectiveFrom, createNewVersion } = req.body;
    const result = await MasterDataService.applyCPIToDriverRates(
      id,
      percentage,
      effectiveFrom,
      createNewVersion
    );
    return res.status(200).json(result);
  });

  static copyHourlyHouseRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rateIds } = req.body;
    const result = await MasterDataService.copyHourlyHouseRates(id, rateIds);
    return res.status(200).json(result);
  });

  static copyFtlHouseRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rateIds } = req.body;
    const result = await MasterDataService.copyFtlHouseRates(id, rateIds);
    return res.status(200).json(result);
  });

  static updateDriverFuelLevy = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateDriverFuelLevy(id, req.body);
    return res.status(200).json(result);
  });

  // ==================== CUSTOMERS ====================
  static getAllCustomers = catchAsyncHandler(async (req, res) => {
    const customers = await MasterDataService.getAllCustomers(req.query);
    return res.status(200).json(customers);
  });

  static createCustomer = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createCustomer(req.body);
    return res.status(201).json(result);
  });

  static toggleCustomerStatus = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const result = await MasterDataService.toggleCustomerStatus(id, isActive);
    return res.status(200).json(result);
  });

  static updateCustomer = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateCustomer(id, req.body);
    return res.status(200).json(result);
  });

  static getCustomerById = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const customer = await MasterDataService.getCustomerById(id);
    return res.status(200).json(customer);
  });

  static getCustomerDocuments = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const documents = await MasterDataService.getCustomerDocuments(id);
    return res.status(200).json(documents);
  });

  static uploadCustomerDocument = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    const { documentType, title } = req.body;
    const userId = req.user._id;

    try {
      const document = await MasterDataService.uploadCustomerDocument(
        id,
        file,
        { documentType, title },
        userId
      );
      return res.status(201).json(document);
    } catch (error) {
      // Clean up uploaded file on error
      if (file && file.path) {
        const fs = require("fs").promises;
        try {
          await fs.unlink(file.path);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
      throw error;
    }
  });

  static deleteCustomerDocument = catchAsyncHandler(async (req, res) => {
    const { id, documentId } = req.params;
    const result = await MasterDataService.deleteCustomerDocument(id, documentId);
    return res.status(200).json(result);
  });

  static downloadCustomerDocument = catchAsyncHandler(async (req, res) => {
    const { id, docId } = req.params;
    const fileInfo = await MasterDataService.downloadCustomerDocument(id, docId);

    // Set headers
    res.setHeader("Content-Type", fileInfo.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileInfo.fileName}"`
    );
    res.setHeader("Content-Length", fileInfo.fileSize);

    // Stream file to response
    const fs = require("fs");
    const fileStream = fs.createReadStream(fileInfo.filePath);

    fileStream.pipe(res);

    fileStream.on("error", (error) => {
      console.error("Error streaming file:", error);
      if (!res.headersSent) {
        return res.status(500).json({
          message: "Failed to download document",
        });
      }
    });
  });

  static getCustomerLinkedDocuments = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const linkedDocuments = await MasterDataService.getCustomerLinkedDocuments(id);
    return res.status(200).json(linkedDocuments);
  });

  // ==================== OPERATIONS CONTACTS ====================
  static getOperationsContacts = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const contacts = await MasterDataService.getOperationsContacts(id);
    return res.status(200).json(contacts);
  });

  static createOperationsContact = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const contact = await MasterDataService.createOperationsContact(id, req.body);
    return res.status(201).json(contact);
  });

  static updateOperationsContact = catchAsyncHandler(async (req, res) => {
    const { id, contactId } = req.params;
    const contact = await MasterDataService.updateOperationsContact(id, contactId, req.body);
    return res.status(200).json(contact);
  });

  static deleteOperationsContact = catchAsyncHandler(async (req, res) => {
    const { id, contactId } = req.params;
    const result = await MasterDataService.deleteOperationsContact(id, contactId);
    return res.status(200).json(result);
  });

  // ==================== BILLING CONTACTS ====================
  static getBillingContacts = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const contacts = await MasterDataService.getBillingContacts(id);
    return res.status(200).json(contacts);
  });

  static createBillingContact = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const contact = await MasterDataService.createBillingContact(id, req.body);
    return res.status(201).json(contact);
  });

  static updateBillingContact = catchAsyncHandler(async (req, res) => {
    const { id, contactId } = req.params;
    const contact = await MasterDataService.updateBillingContact(id, contactId, req.body);
    return res.status(200).json(contact);
  });

  static deleteBillingContact = catchAsyncHandler(async (req, res) => {
    const { id, contactId } = req.params;
    const result = await MasterDataService.deleteBillingContact(id, contactId);
    return res.status(200).json(result);
  });

  // ==================== CUSTOMER FUEL LEVY ====================
  static updateCustomerFuelLevy = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateCustomerFuelLevy(id, req.body);
    return res.status(200).json(result);
  });

  // ==================== CUSTOMER HOURLY RATES ====================
  static getCustomerHourlyRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const rates = await MasterDataService.getCustomerHourlyRates(id);
    return res.status(200).json(rates);
  });

  static createCustomerHourlyRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const rate = await MasterDataService.createCustomerHourlyRate(id, req.body);
    return res.status(201).json(rate);
  });

  static updateCustomerHourlyRate = catchAsyncHandler(async (req, res) => {
    const { id, rateId } = req.params;
    const rate = await MasterDataService.updateCustomerHourlyRate(id, rateId, req.body);
    return res.status(200).json(rate);
  });

  static deleteCustomerHourlyRate = catchAsyncHandler(async (req, res) => {
    const { id, rateId } = req.params;
    const result = await MasterDataService.deleteCustomerHourlyRate(id, rateId);
    return res.status(200).json(result);
  });

  // ==================== CUSTOMER FTL RATES ====================
  static getCustomerFtlRates = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const rates = await MasterDataService.getCustomerFtlRates(id);
    return res.status(200).json(rates);
  });

  static createCustomerFtlRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const rate = await MasterDataService.createCustomerFtlRate(id, req.body);
    return res.status(201).json(rate);
  });

  // ==================== CUSTOMER ONBOARDING ====================
  static sendCustomerOnboarding = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.sendCustomerOnboarding(id, req.body);
    return res.status(200).json(result);
  });

  // ==================== RATE CARDS ====================
  static getAllRateCards = catchAsyncHandler(async (req, res) => {
    const rateCards = await MasterDataService.getAllRateCards(req.query, req.user);
    return res.status(200).json(rateCards);
  });

  static createRateCard = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createRateCard(req.body, req.user);
    return res.status(201).json(result);
  });

  static updateRateCard = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateRateCard(id, req.body);
    return res.status(200).json(result);
  });

  static deleteRateCard = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteRateCard(id);
    return res.status(200).json(result);
  });

  static lockRateCard = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.lockRateCard(id);
    return res.status(200).json(result);
  });

  static unlockRateCard = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.unlockRateCard(id);
    return res.status(200).json(result);
  });

  static applyCPIToRateCards = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.applyCPIToRateCards(req.body, req.user);
    return res.status(200).json(result);
  });

  // ==================== HOURLY HOUSE RATES ====================
  static getAllHourlyHouseRates = catchAsyncHandler(async (req, res) => {
    const rates = await MasterDataService.getAllHourlyHouseRates(req.query, req.user);
    return res.status(200).json(rates);
  });

  static updateHourlyHouseRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateHourlyHouseRate(id, req.body);
    return res.status(200).json(result);
  });

  static deleteHourlyHouseRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteHourlyHouseRate(id);
    return res.status(200).json(result);
  });

  // ==================== FTL HOUSE RATES ====================
  static getFtlHouseRates = catchAsyncHandler(async (req, res) => {
    const rates = await MasterDataService.getFtlHouseRates(req.query, req.user);
    return res.status(200).json(rates);
  });

  static updateFtlHouseRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateFtlHouseRate(id, req.body);
    return res.status(200).json(result);
  });

  static deleteFtlHouseRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteFtlHouseRate(id);
    return res.status(200).json(result);
  });

  static uploadFtlHouseRates = catchAsyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }

    const csvData = req.file.buffer.toString("utf-8");
    const { customerId } = req.body;
    const result = await MasterDataService.uploadFtlHouseRates(csvData, customerId, req.user);
    return res.status(200).json(result);
  });

  static uploadRateCards = catchAsyncHandler(async (req, res) => {
    // Handle CSV file upload (using multer)
    const csvData = req.file ? req.file.buffer.toString() : req.body.csvData;
    const { rateType, customerId } = req.body;

    if (!csvData) {
      return res.status(400).json({
        success: false,
        message: "CSV data is required.",
      });
    }

    const result = await MasterDataService.uploadRateCards(
      csvData,
      rateType,
      customerId,
      req.user
    );
    return res.status(200).json(result);
  });

  static copyFTLRatesToDriverPay = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.copyFTLRatesToDriverPay(req.user);
    return res.status(200).json(result);
  });

  static copyHourlyRatesToDriverPay = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.copyHourlyRatesToDriverPay(req.user);
    return res.status(200).json(result);
  });

  // ==================== FUEL LEVIES ====================
  static getAllFuelLevies = catchAsyncHandler(async (req, res) => {
    const levies = await MasterDataService.getAllFuelLevies(req.user);
    return res.status(200).json(levies);
  });

  static getCurrentFuelLevy = catchAsyncHandler(async (req, res) => {
    const levy = await MasterDataService.getCurrentFuelLevy(req.user);
    return res.status(200).json(levy);
  });

  static getCurrentFuelLevies = catchAsyncHandler(async (req, res) => {
    const levies = await MasterDataService.getCurrentFuelLevies(req.user);
    return res.status(200).json(levies);
  });

  static createFuelLevy = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createFuelLevy(req.body, req.user);
    return res.status(201).json(result);
  });

  static updateFuelLevy = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateFuelLevy(id, req.body);
    return res.status(200).json(result);
  });

  // ==================== SERVICE CODES ====================
  static getAllServiceCodes = catchAsyncHandler(async (req, res) => {
    const codes = await MasterDataService.getAllServiceCodes(req.user, req.query);
    return res.status(200).json(codes);
  });

  static createServiceCode = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createServiceCode(req.body, req.user);
    return res.status(201).json(result);
  });

  static updateServiceCode = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateServiceCode(id, req.body, req.user);
    return res.status(200).json(result);
  });

  static deleteServiceCode = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteServiceCode(id, req.user);
    return res.status(200).json(result);
  });

  // ==================== ANCILLARIES ====================
  static getAllAncillaries = catchAsyncHandler(async (req, res) => {
    const ancillaries = await MasterDataService.getAllAncillaries(req.user, req.query);
    return res.status(200).json(ancillaries);
  });

  static createAncillary = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createAncillary(req.body, req.user);
    return res.status(201).json(result);
  });

  static updateAncillary = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateAncillary(id, req.body, req.user);
    return res.status(200).json(result);
  });

  static deleteAncillary = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteAncillary(id, req.user);
    return res.status(200).json(result);
  });

  // ==================== VEHICLES ====================
  static getAllVehicles = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.getAllVehicles(req.query, req.user);
    return res.status(200).json(result);
  });

  static getVehicleById = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.getVehicleById(id, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  static createVehicle = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createVehicle(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Vehicle created successfully",
      data: result,
    });
  });

  static getVehicleHistory = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.getVehicleHistory(id, req.query, req.user);
    return res.status(200).json(result);
  });

  static getMaintenanceLogs = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.getMaintenanceLogs(id, req.query, req.user);
    return res.status(200).json(result);
  });

  static createMaintenanceLog = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.createMaintenanceLog(id, req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Maintenance log created successfully",
      data: result,
    });
  });

  // ==================== VEHICLE PROFILE ACTIONS ====================
  static getInspections = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.getInspections(req.query, req.user);
    return res.status(200).json(result);
  });

  static createInspection = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createInspection(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Inspection created successfully",
      data: result,
    });
  });

  static getDefects = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.getDefects(req.query, req.user);
    return res.status(200).json(result);
  });

  static createDefect = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createDefect(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Defect reported successfully",
      data: result,
    });
  });

  static getWorkOrders = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.getWorkOrders(req.query, req.user);
    return res.status(200).json(result);
  });

  static createWorkOrder = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createWorkOrder(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Work order created successfully",
      data: result,
    });
  });

  static getSchedules = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.getSchedules(req.query, req.user);
    return res.status(200).json(result);
  });

  static createSchedule = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createSchedule(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Schedule created successfully",
      data: result,
    });
  });

  static getVehicleDocuments = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.getVehicleDocuments(req.query, req.user);
    return res.status(200).json(result);
  });

  static uploadVehicleDocument = catchAsyncHandler(async (req, res) => {
    const file = req.file;
    const formData = { ...req.body };

    try {
      const result = await MasterDataService.uploadVehicleDocument(formData, file, req.user);
      return res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: result,
      });
    } catch (error) {
      // Handle multer errors
      if (error.message && error.message.includes("File too large")) {
        return res.status(413).json({
          success: false,
          message: "File too large",
          error: "File size exceeds 10MB limit",
        });
      }
      throw error; // Re-throw to be handled by global error handler
    }
  });

  // ==================== DOCUMENT TEMPLATES ====================
  static getAllDocumentTemplates = catchAsyncHandler(async (req, res) => {
    const templates = await MasterDataService.getAllDocumentTemplates();
    return res.status(200).json(templates);
  });

  static createDocumentTemplate = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createDocumentTemplate(req.body);
    return res.status(201).json(result);
  });

  static updateDocumentTemplate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateDocumentTemplate(id, req.body);
    return res.status(200).json(result);
  });

  static deleteDocumentTemplate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteDocumentTemplate(id);
    return res.status(200).json(result);
  });

  // ==================== ZONES ====================
  static getAllZones = catchAsyncHandler(async (req, res) => {
    const zones = await MasterDataService.getAllZones();
    return res.status(200).json(zones);
  });

  static createZone = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createZone(req.body);
    return res.status(201).json(result);
  });

  static updateZone = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateZone(id, req.body);
    return res.status(200).json(result);
  });

  static deleteZone = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteZone(id);
    return res.status(200).json(result);
  });

  // ==================== VEHICLE TYPES ====================
  static getAllVehicleTypes = catchAsyncHandler(async (req, res) => {
    const types = await MasterDataService.getAllVehicleTypes(req.user);
    return res.status(200).json(types);
  });

  // ==================== INDUCTIONS ====================
  static getAllInductions = catchAsyncHandler(async (req, res) => {
    const inductions = await MasterDataService.getAllInductions();
    return res.status(200).json(inductions);
  });

  static getDriverInductions = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const inductions = await MasterDataService.getDriverInductions(id);
    return res.status(200).json(inductions);
  });

  static completeDriverInduction = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.completeDriverInduction(id, req.body);
    return res.status(200).json(result);
  });

  static submitDriverApplication = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.submitDriverApplication(req.body);
    return res.status(201).json(result);
  });

  static submitDriverInductionForm = catchAsyncHandler(async (req, res) => {
    // Combine body data and files
    const formData = { ...req.body };
    const files = req.files || {};

    // ⚠️ CRITICAL: Support authenticated users (if Authorization header is present)
    // If user is authenticated, use their userId for driver lookup
    if (req.user && req.user.id) {
      formData.userId = req.user.id;
      // If email not provided, use authenticated user's email
      if (!formData.email && req.user.email) {
        formData.email = req.user.email;
      }
    }

    // Get token from query params or form data
    if (req.query.token && !formData.token) {
      formData.token = req.query.token;
    }
    if (req.query.email && !formData.email) {
      formData.email = req.query.email;
    }

    // Handle single file uploads (multer might give single file or array)
    Object.keys(files).forEach((key) => {
      if (Array.isArray(files[key]) && files[key].length > 0) {
        files[key] = files[key][0]; // Take first file if array
      }
    });

    try {
      const result = await MasterDataService.submitDriverInductionForm(formData, files);
      return res.status(201).json(result);
    } catch (error) {
      // Handle multer errors
      if (error.message && error.message.includes("File too large")) {
        return res.status(413).json({
          success: false,
          message: "File too large",
          error: "File size exceeds 10MB limit",
        });
      }
      if (error.message && error.message.includes("Only PDF")) {
        return res.status(415).json({
          success: false,
          message: "Invalid file type",
          error: error.message,
        });
      }
      throw error; // Re-throw to be handled by global error handler
    }
  });

  static approveDriverInduction = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.approveDriverInduction(id, req.user);
    return res.status(200).json(result);
  });

  static syncDriverUserLink = catchAsyncHandler(async (req, res) => {
    const { userId } = req.params;
    const result = await MasterDataService.syncDriverUserLink(userId);
    return res.status(200).json(result);
  });

  // ==================== HOURLY HOUSE RATES ====================
  static getAllHourlyHouseRates = catchAsyncHandler(async (req, res) => {
    const rates = await MasterDataService.getAllHourlyHouseRates();
    return res.status(200).json(rates);
  });

  static updateHourlyHouseRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateHourlyHouseRate(id, req.body);
    return res.status(200).json(result);
  });

  static deleteHourlyHouseRate = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteHourlyHouseRate(id);
    return res.status(200).json(result);
  });

  // ==================== FTL HOUSE RATES ====================
  static getFtlHouseRates = catchAsyncHandler(async (req, res) => {
    const rates = await MasterDataService.getFtlHouseRates();
    return res.status(200).json(rates);
  });
  // ==================== RCTI LOGS ====================
  static getRCTILogs = catchAsyncHandler(async (req, res) => {
    const logs = await MasterDataService.getRCTILogs(req.query, req.user);
    return res.status(200).json(logs);
  });

  static sendRCTIs = catchAsyncHandler(async (req, res) => {
    const { payRunId } = req.params;
    const result = await MasterDataService.sendRCTIs(
      payRunId,
      req.body,
      req.user
    );
    return res.status(200).json(result);
  });

  // ==================== DRIVER UPLOADS ====================
  static getDriverUploads = catchAsyncHandler(async (req, res) => {
    const { driverId } = req.params;
    const uploads = await MasterDataService.getDriverUploads(
      driverId,
      req.user
    );
    return res.status(200).json(uploads);
  });
}

module.exports = MasterDataController;

