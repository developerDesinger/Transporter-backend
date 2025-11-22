const InvoiceService = require("../services/invoice.service");
const ReceivablesService = require("../services/receivables.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class InvoiceController {
  static getAllInvoices = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.getAllInvoices(req.query, req.user);
    return res.status(200).json(result);
  });

  static buildInvoices = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.buildInvoices(req.body, req.user);
    return res.status(200).json(result);
  });

  static getReceivablesInvoices = catchAsyncHandler(async (req, res) => {
    const invoices = await InvoiceService.getReceivablesInvoices(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: invoices,
    });
  });

  static createReceivablesInvoice = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.createReceivablesInvoice(req.body, req.user);
    return res.status(201).json(result);
  });

  static quickPayInvoice = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await InvoiceService.quickPayInvoice(id, req.body, req.user);
    return res.status(200).json(result);
  });

  static getReceivablesPayments = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.getReceivablesPayments(req.query, req.user);
    return res.status(200).json(result);
  });

  static createReceivablesPayment = catchAsyncHandler(async (req, res) => {
    const payment = await ReceivablesService.createPayment(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      data: payment,
    });
  });

  static getReceivablesSummary = catchAsyncHandler(async (req, res) => {
    const summary = await ReceivablesService.getSummary(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: summary,
    });
  });

  static getReceivablesBatches = catchAsyncHandler(async (req, res) => {
    const batches = await ReceivablesService.getBatches(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: batches,
    });
  });

  static getReceivablesAnomalies = catchAsyncHandler(async (req, res) => {
    const anomalies = await ReceivablesService.getAnomalies(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: anomalies,
    });
  });

  static getReceivablesAnomalyDetails = catchAsyncHandler(async (req, res) => {
    const { paymentNo } = req.params;
    const anomaly = await ReceivablesService.getAnomalyDetails(paymentNo, req.user);
    return res.status(200).json({
      success: true,
      data: anomaly,
    });
  });

  static getReceivablesStatements = catchAsyncHandler(async (req, res) => {
    const statements = await ReceivablesService.getStatements(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: statements,
    });
  });

  static getReceivablesStatementDetails = catchAsyncHandler(async (req, res) => {
    const { statementNo } = req.params;
    const statement = await ReceivablesService.getStatementDetails(statementNo, req.user);
    return res.status(200).json({
      success: true,
      data: statement,
    });
  });

  static createReceivablesStatement = catchAsyncHandler(async (req, res) => {
    const statement = await ReceivablesService.createStatement(req.body, req.user);
    const message =
      statement.status === "Sent"
        ? "Statement created and sent successfully"
        : "Statement created successfully";
    return res.status(201).json({
      success: true,
      message,
      data: statement,
    });
  });

  static getReceivablesSchedules = catchAsyncHandler(async (req, res) => {
    const schedules = await ReceivablesService.getSchedules(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: schedules,
    });
  });

  static createReceivablesSchedule = catchAsyncHandler(async (req, res) => {
    const schedule = await ReceivablesService.createSchedule(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Schedule created successfully",
      data: schedule,
    });
  });

  static updateReceivablesSchedule = catchAsyncHandler(async (req, res) => {
    const { scheduleId } = req.params;
    const schedule = await ReceivablesService.updateSchedule(scheduleId, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Schedule updated successfully",
      data: schedule,
    });
  });

  static deleteReceivablesSchedule = catchAsyncHandler(async (req, res) => {
    const { scheduleId } = req.params;
    await ReceivablesService.deleteSchedule(scheduleId, req.user);
    return res.status(200).json({
      success: true,
      message: "Schedule deleted successfully",
    });
  });

  static getReceivablesCustomerActivity = catchAsyncHandler(async (req, res) => {
    const activities = await ReceivablesService.getCustomerActivity(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: activities,
    });
  });

  static getReceivablesAgingReport = catchAsyncHandler(async (req, res) => {
    const report = await ReceivablesService.getAgingReport(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: report,
    });
  });

  static getReceivablesCalendar = catchAsyncHandler(async (req, res) => {
    const calendar = await ReceivablesService.getCalendar(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: calendar,
    });
  });

  // Invoice Builder endpoints
  static getInvoiceGroups = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.getInvoiceGroups(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  static getAvailableJobs = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.getAvailableJobs(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  static groupJobs = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.groupJobs(req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Jobs grouped successfully",
      data: result,
    });
  });

  static removeJobFromGroup = catchAsyncHandler(async (req, res) => {
    const { groupId, jobId } = req.params;
    const result = await InvoiceService.removeJobFromGroup(groupId, jobId, req.user);
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  });

  static markGroupAsReady = catchAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const result = await InvoiceService.markGroupAsReady(groupId, req.user);
    return res.status(200).json({
      success: true,
      message: "Group marked as ready",
      data: result,
    });
  });

  static createInvoicesFromGroups = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.createInvoicesFromGroups(req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Invoices created successfully",
      data: result,
    });
  });

  static createManualInvoice = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.createManualInvoice(req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Invoice created successfully",
      data: result,
    });
  });

  static sendInvoice = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceService.sendInvoice(req.params.invoiceId, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Invoice sent successfully",
      data: result,
    });
  });
}

module.exports = InvoiceController;

