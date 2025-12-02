const DailyNotesService = require("../services/dailyNotes.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class DailyNotesController {
  /**
   * Get daily notes
   * GET /api/v1/daily-notes
   */
  static getDailyNotes = catchAsyncHandler(async (req, res) => {
    const result = await DailyNotesService.getDailyNotes(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });

  /**
   * Save daily notes
   * POST /api/v1/daily-notes
   */
  static saveDailyNotes = catchAsyncHandler(async (req, res) => {
    const result = await DailyNotesService.saveDailyNotes(req.body, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

module.exports = DailyNotesController;

