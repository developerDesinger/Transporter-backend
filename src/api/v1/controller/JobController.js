const JobService = require("../services/job.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class JobController {
  /**
   * Create a new job
   * POST /api/v1/jobs
   */
  static createJob = catchAsyncHandler(async (req, res) => {
    const job = await JobService.createJob(req.body, req.user);
    return res.status(201).json({
      success: true,
      data: job,
    });
  });
}

module.exports = JobController;

