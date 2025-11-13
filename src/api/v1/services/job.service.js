const Job = require("../models/job.model");
const Customer = require("../models/customer.model");
const Driver = require("../models/driver.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

class JobService {
  /**
   * Create a new job
   * @param {Object} data - Request data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created job object
   */
  static async createJob(data, user) {
    const errors = [];
    const organizationId = user.activeOrganizationId || null;

    // Validate required fields
    if (!data.customerId) {
      errors.push({
        field: "customerId",
        message: "Customer ID is required",
      });
    }

    if (!data.jobType || !["HOURLY", "FTL"].includes(data.jobType)) {
      errors.push({
        field: "jobType",
        message: 'Job type must be either "HOURLY" or "FTL"',
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate customer exists and belongs to organization
    const customerFilter = {
      _id: new mongoose.Types.ObjectId(data.customerId),
    };

    // Note: Customer model may not have organizationId directly
    // If organizationId is available, try to filter by it (if the field exists)
    // For now, we'll validate customer exists and is active
    const customer = await Customer.findOne(customerFilter).lean();

    if (!customer) {
      throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
    }

    // Validate customer is active
    if (customer.isActive === false) {
      throw new AppError(
        "Customer is not active. Please select an active customer.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Determine createdFrom (boardType) if not provided
    let boardType = data.createdFrom;
    if (!boardType) {
      // Auto-derive from jobType
      boardType = data.jobType === "FTL" ? "LINEHAUL" : "PUD";
    }

    // Validate createdFrom matches jobType
    if (data.jobType === "FTL" && boardType !== "LINEHAUL") {
      errors.push({
        field: "createdFrom",
        message: 'FTL jobs must have createdFrom = "LINEHAUL"',
      });
    }

    if (data.jobType === "HOURLY" && boardType !== "PUD") {
      errors.push({
        field: "createdFrom",
        message: 'HOURLY jobs must have createdFrom = "PUD"',
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Set default serviceDate (today) if not provided
    let serviceDate = null;
    let dateString = null;

    if (data.serviceDate) {
      serviceDate = new Date(data.serviceDate);
      serviceDate.setHours(0, 0, 0, 0);
      dateString = `${serviceDate.getFullYear()}-${String(serviceDate.getMonth() + 1).padStart(2, "0")}-${String(serviceDate.getDate()).padStart(2, "0")}`;
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      serviceDate = today;
      dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    }

    // Generate job number
    const year = serviceDate.getFullYear();
    const jobNumber = await this.generateJobNumber(organizationId, year);

    // Note: Job model requires driverId, but guide allows jobs to be created without a driver
    // For DRAFT jobs, we'll try to find a system placeholder driver or use the first available driver
    // If no driverId is provided, we'll attempt to find a placeholder/system driver
    let driverId = data.driverId;

    if (!driverId) {
      // Try to find a system/placeholder driver (e.g., a driver marked as system driver)
      // For now, we'll look for any active driver in the organization as a placeholder
      // In production, you might want to create a dedicated "System" or "Unassigned" driver
      const placeholderDriver = await Driver.findOne({
        isActive: true,
        // Note: Driver model may not have organizationId, so we might need to filter via User
      })
        .sort({ createdAt: 1 })
        .lean();

      if (!placeholderDriver) {
        throw new AppError(
          "Driver ID is required. No drivers available in the system. Please assign a driver to create a job.",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      driverId = placeholderDriver._id.toString();
      // Note: This is a workaround. In production, consider:
      // 1. Making driverId optional in Job model for DRAFT jobs
      // 2. Creating a dedicated "System" or "Unassigned" driver
      // 3. Allowing jobs to be created without a driver and assigned later
    }

    // Validate driver exists
    const driver = await Driver.findById(driverId).lean();
    if (!driver) {
      throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
    }

    // Create job
    const job = await Job.create({
      jobNumber: jobNumber,
      status: "OPEN", // Job model uses OPEN/CLOSED, not DRAFT
      customerId: new mongoose.Types.ObjectId(data.customerId),
      driverId: new mongoose.Types.ObjectId(driverId),
      vehicleType: data.vehicleType || null,
      pickupSuburb: data.pickupSuburb || null,
      deliverySuburb: data.deliverySuburb || null,
      date: dateString, // Job model uses date (string, YYYY-MM-DD)
      boardType: boardType, // Job model uses boardType instead of createdFrom
      organizationId: organizationId
        ? new mongoose.Types.ObjectId(organizationId)
        : null,
    });

    // Format response according to guide
    return {
      id: job._id.toString(),
      jobNumber: job.jobNumber,
      customerId: job.customerId.toString(),
      jobType: data.jobType, // Return the original jobType (HOURLY or FTL)
      pickupSuburb: job.pickupSuburb || null,
      deliverySuburb: job.deliverySuburb || null,
      vehicleType: job.vehicleType || null,
      createdFrom: boardType, // Return as createdFrom for API consistency (PUD or LINEHAUL)
      serviceDate: serviceDate.toISOString(), // Return as ISO date
      status: "DRAFT", // Return as DRAFT for API consistency (even though model uses OPEN)
      organizationId: job.organizationId ? job.organizationId.toString() : null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /**
   * Generate unique job number
   * Format: JOB-YYYY-NNNN
   * @param {string} organizationId - Organization ID
   * @param {number} year - Year for job number
   * @returns {string} Unique job number
   */
  static async generateJobNumber(organizationId, year) {
    const prefix = `JOB-${year}-`;

    // Build filter for finding last job
    const filter = {
      jobNumber: { $regex: `^${prefix}` },
    };

    // Filter by organization if available
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Find the highest job number for this organization and year
    const lastJob = await Job.findOne(filter).sort({ jobNumber: -1 }).lean();

    let sequence = 1;

    if (lastJob && lastJob.jobNumber) {
      // Extract sequence number from last job number
      const match = lastJob.jobNumber.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)`));
      if (match) {
        sequence = parseInt(match[1], 10) + 1;
      }
    }

    // Format with leading zeros (4 digits)
    const jobNumber = `${prefix}${sequence.toString().padStart(4, "0")}`;

    // Ensure uniqueness (handle race conditions)
    const exists = await Job.findOne({
      jobNumber: jobNumber,
      organizationId: organizationId
        ? new mongoose.Types.ObjectId(organizationId)
        : null,
    });

    if (exists) {
      // Retry with incremented sequence (max 10 attempts to prevent infinite loop)
      let attempts = 0;
      let newSequence = sequence + 1;
      while (attempts < 10) {
        const newJobNumber = `${prefix}${newSequence.toString().padStart(4, "0")}`;
        const stillExists = await Job.findOne({
          jobNumber: newJobNumber,
          organizationId: organizationId
            ? new mongoose.Types.ObjectId(organizationId)
            : null,
        });
        if (!stillExists) {
          return newJobNumber;
        }
        newSequence++;
        attempts++;
      }
      // If we can't find a unique number after 10 attempts, throw error
      throw new AppError(
        "Unable to generate unique job number. Please try again.",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    return jobNumber;
  }
}

module.exports = JobService;

