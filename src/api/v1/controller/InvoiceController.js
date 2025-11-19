const InvoiceService = require("../services/invoice.service");
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

