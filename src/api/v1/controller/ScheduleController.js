const ScheduleService = require("../services/schedule.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class ScheduleController {
  /**
   * Get upcoming schedule for dashboard card
   * GET /api/v1/schedule/upcoming
   */
  static getUpcomingSchedule = catchAsyncHandler(async (req, res) => {
    const data = await ScheduleService.getUpcomingSchedule(req.query, req.user);
    return res.status(200).json({
      success: true,
      data,
    });
  });
}

module.exports = ScheduleController;


