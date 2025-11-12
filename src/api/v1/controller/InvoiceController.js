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
}

module.exports = InvoiceController;

