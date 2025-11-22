const AdjustmentService = require("../services/adjustment.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class AdjustmentController {
  static getSummary = catchAsyncHandler(async (req, res) => {
    const summary = await AdjustmentService.getSummary(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: summary,
    });
  });

  static getAdjustments = catchAsyncHandler(async (req, res) => {
    const result = await AdjustmentService.getAdjustments(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  });

  static createAdjustment = catchAsyncHandler(async (req, res) => {
    const adjustment = await AdjustmentService.createAdjustment(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Adjustment created successfully",
      data: adjustment,
    });
  });

  static getAdjustmentDetails = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const adjustment = await AdjustmentService.getAdjustmentDetails(id, req.user);
    return res.status(200).json({
      success: true,
      data: adjustment,
    });
  });

  static updateAdjustment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const adjustment = await AdjustmentService.updateAdjustment(id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Adjustment updated successfully",
      data: adjustment,
    });
  });

  static deleteAdjustment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    await AdjustmentService.deleteAdjustment(id, req.user);
    return res.status(200).json({
      success: true,
      message: "Adjustment deleted successfully",
    });
  });

  static sendAdjustment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    await AdjustmentService.sendAdjustment(id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Adjustment sent successfully",
    });
  });

  static approveAdjustment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AdjustmentService.approveAdjustment(id, req.user);
    return res.status(200).json({
      success: true,
      message: "Adjustment approved successfully",
      data: result,
    });
  });

  static applyAdjustment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AdjustmentService.applyAdjustment(id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: "Adjustment applied successfully",
      data: result,
    });
  });

  static resendAdjustment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await AdjustmentService.resendAdjustment(id, req.user);
    return res.status(200).json({
      success: true,
      message: "Adjustment resent successfully",
      data: result,
    });
  });

  static downloadAdjustmentPDF = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // Get adjustment details first to get the adjustment number for filename
    const adjustment = await AdjustmentService.getAdjustmentDetails(id, req.user);
    const pdfBuffer = await AdjustmentService.generateAdjustmentPDF(id, req.user);
    const filename = `adjustment-${adjustment.adjustmentNumber}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  });
}

module.exports = AdjustmentController;

