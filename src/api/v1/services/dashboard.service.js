const Driver = require("../models/driver.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

class DashboardService {
  /**
   * Get dashboard statistics
   * @param {Object} user - User object (for permissions and organization)
   * @returns {Object} Dashboard stats (revenue, activeJobs, driversOnDuty)
   */
  static async getDashboardStats(user) {
    // Note: Job model not yet available - placeholder implementation
    // TODO: Implement when Job model is available
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Placeholder: Calculate today's revenue from completed jobs
    // const Job = require("../models/job.model");
    // const revenue = await Job.aggregate([
    //   {
    //     $match: {
    //       organizationId: user.activeOrganizationId,
    //       status: "COMPLETED",
    //       completedAt: { $gte: today },
    //     },
    //   },
    //   {
    //     $group: {
    //       _id: null,
    //       total: { $sum: "$totalAmount" },
    //     },
    //   },
    // ]);
    const revenue = 0; // Placeholder

    // Placeholder: Count active jobs
    // const activeJobs = await Job.countDocuments({
    //   organizationId: user.activeOrganizationId,
    //   status: { $in: ["ASSIGNED", "IN_PROGRESS"] },
    // });
    const activeJobs = 0; // Placeholder

    // Count drivers on duty (active and compliant)
    const driversOnDuty = await Driver.countDocuments({
      isActive: true,
      driverStatus: "COMPLIANT",
    });

    return {
      revenue: revenue.toFixed(2),
      activeJobs,
      driversOnDuty,
    };
  }

  /**
   * Get today's jobs
   * @param {Object} user - User object (for permissions and filtering)
   * @returns {Array} Array of today's jobs
   */
  static async getTodayJobs(user) {
    // Note: Job model not yet available - placeholder implementation
    // TODO: Implement when Job model is available

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // If user is a driver, find their driver record
    if (user.role === "DRIVER") {
      const driver = await Driver.findOne({ userId: user.id });

      if (!driver) {
        // Driver record doesn't exist, return empty array
        return [];
      }

      // Placeholder: Filter jobs by assigned driver
      // const Job = require("../models/job.model");
      // const jobs = await Job.find({
      //   organizationId: user.activeOrganizationId,
      //   scheduledDate: { $gte: today, $lt: tomorrow },
      //   "assignment.driverId": driver._id,
      // })
      //   .populate({
      //     path: "customerId",
      //     populate: { path: "partyId" },
      //   })
      //   .populate({
      //     path: "assignment.driverId",
      //     populate: { path: "partyId" },
      //   })
      //   .sort({ scheduledDate: 1 })
      //   .limit(10)
      //   .lean();

      return []; // Placeholder - return empty array
    }

    // For non-drivers, return all today's jobs
    // Placeholder: Get all jobs for today
    // const Job = require("../models/job.model");
    // const jobs = await Job.find({
    //   organizationId: user.activeOrganizationId,
    //   scheduledDate: { $gte: today, $lt: tomorrow },
    // })
    //   .populate({
    //     path: "customerId",
    //     populate: { path: "partyId" },
    //   })
    //   .populate({
    //     path: "assignment.driverId",
    //     populate: { path: "partyId" },
    //   })
    //   .sort({ scheduledDate: 1 })
    //   .limit(10)
    //   .lean();

    return []; // Placeholder - return empty array
  }

  /**
   * Get active drivers (compliant and active)
   * @param {Object} user - User object (for permissions)
   * @returns {Array} Array of active drivers
   */
  static async getActiveDrivers(user) {
    const drivers = await Driver.find({
      isActive: true,
      driverStatus: "COMPLIANT",
    })
      .populate("party", "firstName lastName email phone companyName")
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();

    return drivers.map((driver) => ({
      id: driver._id.toString(),
      party: driver.party
        ? {
            id: driver.party._id.toString(),
            firstName: driver.party.firstName,
            lastName: driver.party.lastName,
            email: driver.party.email,
            phone: driver.party.phone,
            companyName: driver.party.companyName,
          }
        : null,
      defaultVehicleType: driver.defaultVehicleType || null,
      isActive: driver.isActive,
      driverStatus: driver.driverStatus,
      driverCode: driver.driverCode,
    }));
  }
}

module.exports = DashboardService;

