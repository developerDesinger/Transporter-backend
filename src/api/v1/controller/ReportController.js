const ReportService = require("../services/report.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class ReportController {
  /**
   * Get customer churn report
   * GET /api/v1/reports/customer-churn
   */
  static getCustomerChurnReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getCustomerChurnReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get banned entities report
   * GET /api/v1/reports/banned-entities
   */
  static getBannedEntitiesReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getBannedEntitiesReport(req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get invoices report
   * GET /api/v1/reports/invoices
   */
  static getInvoicesReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getInvoicesReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get pay runs report
   * GET /api/v1/reports/pay-runs
   */
  static getPayRunsReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getPayRunsReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get margins report
   * GET /api/v1/reports/margins
   */
  static getMarginsReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getMarginsReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get jobs report
   * GET /api/v1/reports/jobs
   */
  static getJobsReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getJobsReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get driver hours report
   * GET /api/v1/reports/driver-hours
   */
  static getDriverHoursReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getDriverHoursReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get fatigue report
   * GET /api/v1/reports/fatigue
   */
  static getFatigueReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getFatigueReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get open jobs report
   * GET /api/v1/reports/open-jobs
   */
  static getOpenJobsReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getOpenJobsReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get revenue overview report
   * GET /api/v1/reports/revenue-overview
   */
  static getRevenueOverview = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getRevenueOverview(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Get top performers report
   * GET /api/v1/reports/top-performers
   */
  static getTopPerformersReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.getTopPerformersReport(
      req.query,
      req.user
    );
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Export report
   * GET /api/v1/reports/export
   */
  static exportReport = catchAsyncHandler(async (req, res) => {
    const result = await ReportService.exportReport(req.query, req.user);

    // Set headers
    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );

    // Send file buffer
    return res.status(200).send(result.buffer);
  });
}

module.exports = ReportController;

