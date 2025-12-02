const AssignmentService = require("../services/assignment.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");
const HttpStatusCodes = require("../enums/httpStatusCode");

class AssignmentController {
  /**
   * Update assignment details
   * PATCH /api/v1/assignments/:id
   */
  static updateAssignment = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const assignment = await AssignmentService.updateAssignment(
      id,
      req.body,
      req.user
    );
    return res.status(200).json({
      success: true,
      data: assignment,
    });
  });

  /**
   * Request paperwork SMS for an assignment
   * POST /api/v1/assignments/:id/request-paperwork-sms
   */
  static requestPaperworkSms = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
      const assignment = await AssignmentService.requestPaperworkSms(id, req.user);
      return res.status(200).json({
        success: true,
        data: assignment,
      });
    } catch (error) {
      // Handle SMS service failure - still return updated assignment
      if (error.statusCode === HttpStatusCodes.INTERNAL_SERVER_ERROR && error.data) {
        return res.status(500).json({
          success: false,
          message: error.message,
          error: "SMS service error",
          data: error.data,
        });
      }
      throw error;
    }
  });
}

module.exports = AssignmentController;

