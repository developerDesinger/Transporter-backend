const PlanningService = require("../services/planning.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class PlanningController {
  /**
   * Get planning sheet
   * GET /api/v1/planning-sheet
   */
  static getPlanningSheet = catchAsyncHandler(async (req, res) => {
    const result = await PlanningService.getPlanningSheet(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Save planning sheet
   * POST /api/v1/planning-sheet
   */
  static savePlanningSheet = catchAsyncHandler(async (req, res) => {
    const result = await PlanningService.savePlanningSheet(req.body, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Delete planning row
   * DELETE /api/v1/planning-sheet/rows/:rowId
   */
  static deletePlanningRow = catchAsyncHandler(async (req, res) => {
    const result = await PlanningService.deletePlanningRow(
      {
        rowId: req.params.rowId,
        date: req.query.date,
        organizationId: req.query.organizationId,
      },
      req.user
    );
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Delete planning column
   * DELETE /api/v1/planning-sheet/columns/:columnKey
   */
  static deletePlanningColumn = catchAsyncHandler(async (req, res) => {
    const result = await PlanningService.deletePlanningColumn(
      {
        columnKey: req.params.columnKey,
        date: req.query.date,
        organizationId: req.query.organizationId,
      },
      req.user
    );
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

module.exports = PlanningController;

