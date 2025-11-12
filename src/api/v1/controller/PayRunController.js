const PayRunService = require("../services/payRun.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class PayRunController {
  /**
   * GET /api/v1/pay-runs
   * Get all pay runs with optional filtering, sorting, and pagination
   */
  static getAllPayRuns = catchAsyncHandler(async (req, res) => {
    const result = await PayRunService.getAllPayRuns(req.query, req.user);
    return res.status(200).json(result);
  });

  /**
   * GET /api/v1/pay-runs/:id
   * Get pay run detail by ID
   */
  static getPayRunById = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await PayRunService.getPayRunById(id, req.user);
    return res.status(200).json(result);
  });

  /**
   * GET /api/v1/pay-runs/:id/drivers
   * Get all drivers in a pay run
   */
  static getPayRunDrivers = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const drivers = await PayRunService.getPayRunDrivers(id, req.user);
    return res.status(200).json(drivers);
  });

  /**
   * GET /api/v1/pay-runs/:id/items
   * Get all items in a pay run
   */
  static getPayRunItems = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const items = await PayRunService.getPayRunItems(id, req.query, req.user);
    return res.status(200).json(items);
  });

  /**
   * POST /api/v1/pay-runs/:id/rebuild
   * Rebuild a pay run (re-query eligibility, preserve exclusions)
   */
  static rebuildPayRun = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await PayRunService.rebuildPayRun(id, req.user);
    return res.status(200).json(result);
  });

  /**
   * POST /api/v1/pay-runs/:id/post
   * Post a pay run (finalize it)
   */
  static postPayRun = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await PayRunService.postPayRun(id, req.user);
    return res.status(200).json(result);
  });

  /**
   * POST /api/v1/pay-runs/build
   * Build a new pay run
   */
  static buildPayRun = catchAsyncHandler(async (req, res) => {
    const result = await PayRunService.buildPayRun(req.body, req.user);
    return res.status(201).json(result);
  });
}

module.exports = PayRunController;

