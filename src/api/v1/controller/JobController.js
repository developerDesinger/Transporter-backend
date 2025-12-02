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

  /**
   * Get jobs by service date
   * GET /api/v1/jobs?date=YYYY-MM-DD
   */
  static getJobs = catchAsyncHandler(async (req, res) => {
    const jobs = await JobService.getJobs(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: jobs,
    });
  });

  /**
   * Assign a driver to a job
   * POST /api/v1/jobs/:id/assign
   */
  static assignDriver = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = await JobService.assignDriver(id, req.body, req.user);
    return res.status(200).json({
      success: true,
      data: job,
    });
  });

  /**
   * Get jobs for close view with filtering
   * GET /api/v1/jobs/close-view
   */
  static getCloseViewJobs = catchAsyncHandler(async (req, res) => {
    const jobs = await JobService.getCloseViewJobs(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: jobs,
    });
  });

  /**
   * Close a job and create AR/AP entries
   * POST /api/v1/jobs/:id/close
   */
  static closeJob = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await JobService.closeJob(id, req.user);
    return res.status(200).json({
      success: true,
      data: result,
    });
  });
}

module.exports = JobController;

