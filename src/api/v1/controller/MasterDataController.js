const MasterDataService = require("../services/masterData.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class MasterDataController {
  // ==================== DRIVERS ====================
  static getAllDrivers = catchAsyncHandler(async (req, res) => {
    const drivers = await MasterDataService.getAllDrivers(req.query);
    return res.status(200).json(drivers);
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

  // ==================== RATE CARDS ====================
  static getAllRateCards = catchAsyncHandler(async (req, res) => {
    const rateCards = await MasterDataService.getAllRateCards(req.query);
    return res.status(200).json(rateCards);
  });

  static createRateCard = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createRateCard(req.body);
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
    const { percentage, effectiveFrom, createNewVersion, rateType } = req.body;
    const result = await MasterDataService.applyCPIToRateCards(
      percentage,
      effectiveFrom,
      createNewVersion,
      rateType
    );
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
      customerId
    );
    return res.status(200).json(result);
  });

  static copyFTLRatesToDriverPay = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.copyFTLRatesToDriverPay();
    return res.status(200).json(result);
  });

  static copyHourlyRatesToDriverPay = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.copyHourlyRatesToDriverPay();
    return res.status(200).json(result);
  });

  // ==================== FUEL LEVIES ====================
  static getAllFuelLevies = catchAsyncHandler(async (req, res) => {
    const levies = await MasterDataService.getAllFuelLevies();
    return res.status(200).json(levies);
  });

  static getCurrentFuelLevy = catchAsyncHandler(async (req, res) => {
    const { rateType } = req.query;
    const levy = await MasterDataService.getCurrentFuelLevy(rateType);
    return res.status(200).json(levy);
  });

  static getCurrentFuelLevies = catchAsyncHandler(async (req, res) => {
    const levies = await MasterDataService.getCurrentFuelLevies();
    return res.status(200).json(levies);
  });

  static createFuelLevy = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createFuelLevy(req.body);
    return res.status(201).json(result);
  });

  static updateFuelLevy = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateFuelLevy(id, req.body);
    return res.status(200).json(result);
  });

  // ==================== SERVICE CODES ====================
  static getAllServiceCodes = catchAsyncHandler(async (req, res) => {
    const codes = await MasterDataService.getAllServiceCodes();
    return res.status(200).json(codes);
  });

  static createServiceCode = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createServiceCode(req.body);
    return res.status(201).json(result);
  });

  static updateServiceCode = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateServiceCode(id, req.body);
    return res.status(200).json(result);
  });

  static deleteServiceCode = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteServiceCode(id);
    return res.status(200).json(result);
  });

  // ==================== ANCILLARIES ====================
  static getAllAncillaries = catchAsyncHandler(async (req, res) => {
    const ancillaries = await MasterDataService.getAllAncillaries();
    return res.status(200).json(ancillaries);
  });

  static createAncillary = catchAsyncHandler(async (req, res) => {
    const result = await MasterDataService.createAncillary(req.body);
    return res.status(201).json(result);
  });

  static updateAncillary = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.updateAncillary(id, req.body);
    return res.status(200).json(result);
  });

  static deleteAncillary = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await MasterDataService.deleteAncillary(id);
    return res.status(200).json(result);
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
    const types = await MasterDataService.getAllVehicleTypes();
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
}

module.exports = MasterDataController;

