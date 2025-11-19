const InvoiceDeliveryService = require("../services/invoiceDelivery.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class InvoiceDeliveryController {
  static getSummary = catchAsyncHandler(async (req, res) => {
    const data = await InvoiceDeliveryService.getSummary(req.query, req.user);
    return res.status(200).json({
      success: true,
      data,
    });
  });

  static getDeliveries = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceDeliveryService.getDeliveries(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  });

  static getDeliveryDetail = catchAsyncHandler(async (req, res) => {
    const data = await InvoiceDeliveryService.getDeliveryDetail(req.params.deliveryId, req.user);
    return res.status(200).json({
      success: true,
      data,
    });
  });

  static resendInvoice = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceDeliveryService.resendInvoice(req.params.deliveryId, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: {
        deliveryId: result.deliveryId,
      },
    });
  });

  static handleWebhook = catchAsyncHandler(async (req, res) => {
    const result = await InvoiceDeliveryService.handleWebhook(req.body, req.headers);
    return res.status(200).json(result);
  });
}

module.exports = InvoiceDeliveryController;

