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
}

module.exports = InvoiceController;

