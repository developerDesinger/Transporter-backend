const AllocatorService = require("../services/allocator.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class AllocatorController {
  // ==================== ALLOCATOR ROWS ====================

  static getRowsByRange = catchAsyncHandler(async (req, res) => {
    const rows = await AllocatorService.getRowsByRange(req.query, req.user);
    return res.status(200).json(rows);
  });

  static createRow = catchAsyncHandler(async (req, res) => {
    const result = await AllocatorService.createRow(req.body, req.user);
    return res.status(201).json(result);
  });

  static updateRow = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AllocatorService.updateRow(id, req.body, req.user);
    return res.status(200).json(result);
  });

  static lockRow = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AllocatorService.lockRow(id, req.user);
    return res.status(200).json(result);
  });

  static unlockRow = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AllocatorService.unlockRow(id, req.user);
    return res.status(200).json(result);
  });

  static lockBatch = catchAsyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids array is required and must not be empty",
      });
    }
    const result = await AllocatorService.lockBatch(ids, req.user);
    return res.status(200).json(result);
  });

  static unlockBatch = catchAsyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids array is required and must not be empty",
      });
    }
    const result = await AllocatorService.unlockBatch(ids, req.user);
    return res.status(200).json(result);
  });

  static deleteBatch = catchAsyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids array is required and must not be empty",
      });
    }
    const result = await AllocatorService.deleteBatch(ids, req.user);
    return res.status(200).json(result);
  });

  // ==================== MASTER DATA ====================

  static getEligibleCustomers = catchAsyncHandler(async (req, res) => {
    const customers = await AllocatorService.getEligibleCustomers(req.user);
    return res.status(200).json(customers);
  });

  static getAllDrivers = catchAsyncHandler(async (req, res) => {
    const drivers = await AllocatorService.getAllDrivers(req.user);
    return res.status(200).json(drivers);
  });

  static getVehicleTypes = catchAsyncHandler(async (req, res) => {
    const vehicleTypes = await AllocatorService.getVehicleTypes();
    return res.status(200).json(vehicleTypes);
  });

  // ==================== JOB MANAGEMENT ====================

  static getJobById = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = await AllocatorService.getJobById(id, req.user);
    return res.status(200).json(job);
  });

  static sendToDriver = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { method } = req.body;
    
    if (!method || !["sms", "whatsapp", "email"].includes(method)) {
      return res.status(400).json({
        success: false,
        message: "method is required and must be 'sms', 'whatsapp', or 'email'",
      });
    }

    const result = await AllocatorService.sendJobToDriver(id, method, req.user);
    return res.status(200).json(result);
  });

  static requestPaperworkSms = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AllocatorService.requestPaperworkSms(id, req.user);
    return res.status(200).json(result);
  });

  static getAvailability = catchAsyncHandler(async (req, res) => {
    const { date } = req.query;
    const availabilities = await AllocatorService.getAvailability(date, req.user);
    return res.status(200).json(availabilities);
  });

  // ==================== ATTACHMENTS ====================

  static getAttachments = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const attachments = await AllocatorService.getAttachments(id);
    return res.status(200).json(attachments);
  });

  static uploadAttachment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const attachment = await AllocatorService.uploadAttachment(id, file, req.user);
    return res.status(201).json(attachment);
  });

  static deleteAttachment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AllocatorService.deleteAttachment(id, req.user);
    return res.status(200).json(result);
  });

  // ==================== USER PREFERENCES ====================

  static getPreferences = catchAsyncHandler(async (req, res) => {
    const { boardType } = req.params;
    const preferences = await AllocatorService.getPreferences(boardType, req.user);
    return res.status(200).json(preferences);
  });

  static savePreferences = catchAsyncHandler(async (req, res) => {
    const { boardType } = req.params;
    const result = await AllocatorService.savePreferences(boardType, req.body, req.user);
    return res.status(200).json(result);
  });

  // ==================== ANCILLARIES ====================

  static getAncillaries = catchAsyncHandler(async (req, res) => {
    const ancillaries = await AllocatorService.getAncillaries();
    return res.status(200).json(ancillaries);
  });

  static getCustomerRateCards = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const rateCards = await AllocatorService.getCustomerRateCards(id);
    return res.status(200).json(rateCards);
  });

  static getRateCardAncillaryLines = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const lines = await AllocatorService.getRateCardAncillaryLines(id);
    return res.status(200).json(lines);
  });

  // ==================== DRIVER USAGE ====================

  static trackDriverUsage = catchAsyncHandler(async (req, res) => {
    const result = await AllocatorService.trackDriverUsage(req.body, req.user);
    return res.status(200).json(result);
  });
}

module.exports = AllocatorController;

