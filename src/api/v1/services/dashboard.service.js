const Driver = require("../models/driver.model");
const Job = require("../models/job.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

class DashboardService {
  /**
   * Get dashboard statistics
   * @param {Object} user - User object (for permissions and organization)
   * @returns {Object} Dashboard stats (revenue, activeJobs, driversOnDuty)
   */
  static async getDashboardStats(user) {
    const organizationId = user.activeOrganizationId || null;

    // Calculate today's revenue from completed jobs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's date in ISO format (YYYY-MM-DD) for string date comparison
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Build revenue query filter
    // Include jobs completed today OR jobs with service date today (if completedAt is not set)
    const revenueFilter = {
      status: "CLOSED", // Completed jobs
      $or: [
        // Jobs completed today (completedAt matches today)
        {
          completedAt: {
            $gte: today,
            $lt: tomorrow,
          },
        },
        // Or jobs with service date today (if completedAt is not set)
        {
          date: todayString,
          completedAt: { $exists: false },
        },
      ],
    };

    // Add organization filter if available
    if (organizationId) {
      revenueFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      revenueFilter.organizationId = null;
    }

    // Calculate revenue using aggregation
    // Use customerCharge, or fallback to other amount fields if available
    const revenueResult = await Job.aggregate([
      {
        $match: revenueFilter,
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: [
                "$customerCharge",
                {
                  $ifNull: [
                    "$totalAmount",
                    {
                      $ifNull: ["$invoiceAmount", { $ifNull: ["$baseCharge", 0] }],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    ]);

    const revenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    // Count active jobs (OPEN status)
    const activeJobsFilter = {
      status: "OPEN",
    };

    // Add organization filter if available
    if (organizationId) {
      activeJobsFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      activeJobsFilter.organizationId = null;
    }

    const activeJobs = await Job.countDocuments(activeJobsFilter);

    // Count drivers on duty (active and compliant)
    // Note: Driver model may not have organizationId directly
    // We'll filter by isActive and COMPLIANT status
    // If organizationId filtering is needed, it may need to be done via User relationships
    const driversOnDutyFilter = {
      isActive: true,
      $or: [
        { driverStatus: "COMPLIANT" },
        { complianceStatus: "COMPLIANT" },
      ],
    };

    // If organizationId is available and Driver model has organizationId field,
    // we can add it. Otherwise, we'll count all compliant drivers.
    // Note: This may need adjustment based on your Driver model structure
    const driversOnDuty = await Driver.countDocuments(driversOnDutyFilter);

    return {
      success: true,
      data: {
        revenue: revenue.toFixed(2),
        activeJobs: activeJobs,
        driversOnDuty: driversOnDuty,
      },
    };
  }

  /**
   * Get today's jobs
   * @param {Object} user - User object (for permissions and filtering)
   * @returns {Array} Array of today's jobs
   */
  static async getTodayJobs(user) {
    const organizationId = user.activeOrganizationId || null;

    // Calculate today's date in ISO format (YYYY-MM-DD)
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Build query filter
    // Include both OPEN (active) and CLOSED (completed) jobs for today
    // OPEN = ASSIGNED, IN_PROGRESS, DISPATCHED
    // CLOSED = COMPLETED
    const filter = {
      date: todayString,
      status: { $in: ["OPEN", "CLOSED"] }, // Include active and completed jobs
    };

    // Add organization filter if available
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Query today's jobs with populated customer and driver data
    const jobs = await Job.find(filter)
      .populate({
        path: "customerId",
        model: "Customer",
        select: "partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "firstName lastName companyName",
        },
      })
      .populate({
        path: "driverId",
        model: "Driver",
        select: "driverCode partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "firstName lastName companyName",
        },
      })
      .sort({ startTime: 1, jobNumber: 1 })
      .lean();

    // Format response according to guide
    const formattedJobs = jobs.map((job) => {
      const customer = job.customerId;
      const party = customer?.partyId;
      const driver = job.driverId;
      const driverParty = driver?.partyId;

      // Get customer name
      let customerFirstName = "";
      let customerLastName = "";
      let customerCompanyName = "";

      if (party) {
        customerFirstName = party.firstName || "";
        customerLastName = party.lastName || "";
        customerCompanyName = party.companyName || "";
      }

      // Get driver name
      let driverFullName = "";
      if (driverParty) {
        if (driverParty.companyName) {
          driverFullName = driverParty.companyName;
        } else if (driverParty.firstName || driverParty.lastName) {
          driverFullName = `${driverParty.firstName || ""} ${driverParty.lastName || ""}`.trim();
        }
      }

      // Format service date (convert string date to ISO date)
      let serviceDate = null;
      if (job.date) {
        // job.date is in YYYY-MM-DD format, convert to ISO date
        serviceDate = new Date(job.date + "T00:00:00.000Z").toISOString();
      }

      return {
        id: job._id.toString(),
        jobNumber: job.jobNumber || `JOB-${job._id.toString().substring(0, 8)}`,
        serviceDate: serviceDate,
        customerId: customer ? customer._id.toString() : job.customerId?.toString() || "",
        customer: customer
          ? {
              id: customer._id.toString(),
              firstName: customerFirstName,
              lastName: customerLastName,
              companyName: customerCompanyName,
            }
          : undefined,
        pickupSuburb: job.pickupSuburb || "",
        deliverySuburb: job.deliverySuburb || "",
        status: job.status, // "OPEN" or "CLOSED"
        startTime: job.startTime || "",
        finishTime: job.finishTime || "",
        driverId: driver ? driver._id.toString() : job.driverId?.toString() || undefined,
        driver: driver
          ? {
              id: driver._id.toString(),
              driverCode: driver.driverCode || "",
              fullName: driverFullName,
            }
          : undefined,
        vehicleType: job.vehicleType || "",
        jobType: job.boardType || "", // Using boardType as jobType (PUD or LINEHAUL)
      };
    });

    return {
      success: true,
      data: formattedJobs,
    };
  }

  /**
   * Get active drivers (compliant and active)
   * @param {Object} user - User object (for permissions and organization)
   * @returns {Array} Array of active drivers
   */
  static async getActiveDrivers(user) {
    const organizationId = user.activeOrganizationId || null;

    // Build query filter
    // Note: Driver model may not have organizationId directly
    // We'll filter by isActive and COMPLIANT status
    // If organizationId filtering is needed, it may need to be done via User relationships
    const filter = {
      isActive: true,
      $or: [
        { driverStatus: "COMPLIANT" },
        { complianceStatus: "COMPLIANT" },
      ],
    };

    // Query active drivers with populated party data
    const drivers = await Driver.find(filter)
      .populate({
        path: "partyId",
        model: "Party",
        select: "firstName lastName email phone companyName",
      })
      .sort({ driverCode: 1 }) // Sort by driverCode, then by name if needed
      .lean();

    // Format response according to guide
    const formattedDrivers = drivers.map((driver) => {
      const party = driver.partyId;

      // Get driver full name from party
      let fullName = "";
      if (party) {
        if (party.companyName) {
          fullName = party.companyName;
        } else if (party.firstName || party.lastName) {
          fullName = `${party.firstName || ""} ${party.lastName || ""}`.trim();
        }
      }

      // Get default vehicle type (from vehicleTypesInFleet array if available)
      const defaultVehicleType =
        driver.defaultVehicleType ||
        (driver.vehicleTypesInFleet && driver.vehicleTypesInFleet.length > 0
          ? driver.vehicleTypesInFleet[0]
          : "");

      return {
        id: driver._id.toString(),
        driverCode: driver.driverCode || "",
        fullName: fullName || "Unknown",
        isActive: driver.isActive,
        driverStatus: driver.driverStatus || "",
        complianceStatus: driver.complianceStatus || "",
        defaultVehicleType: defaultVehicleType,
        party: party
          ? {
              id: party._id.toString(),
              firstName: party.firstName || "",
              lastName: party.lastName || "",
              email: party.email || "",
              phone: party.phone || "",
              companyName: party.companyName || "",
            }
          : {
              id: "",
              firstName: "",
              lastName: "",
              email: "",
              phone: "",
              companyName: "",
            },
      };
    });

    return {
      success: true,
      data: formattedDrivers,
    };
  }
}

module.exports = DashboardService;

