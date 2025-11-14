const Job = require("../models/job.model");
const Customer = require("../models/customer.model");
const Driver = require("../models/driver.model");
const Assignment = require("../models/assignment.model");
const AllocatorRow = require("../models/allocatorRow.model");
const InvoiceDraftLine = require("../models/invoiceDraftLine.model");
const PayRunItem = require("../models/payRunItem.model");
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

    // Validate driver if provided (driverId is optional)
    let driverId = data.driverId || null;
    let driver = null;
    let shouldCreateAssignment = false;

    if (driverId) {
      // Validate driverId format
      if (!mongoose.Types.ObjectId.isValid(driverId)) {
        throw new AppError("Invalid driver ID format", HttpStatusCodes.BAD_REQUEST);
      }

      // Validate driver exists and is active
      driver = await Driver.findById(driverId)
        .populate({
          path: "partyId",
          model: "Party",
          select: "firstName lastName email phone companyName",
        })
        .lean();

      if (!driver) {
        throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
      }

      // Validate driver is active
      if (!driver.isActive) {
        throw new AppError(
          "Driver is inactive or non-compliant",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Validate driver is compliant
      const isCompliant =
        driver.driverStatus === "COMPLIANT" ||
        driver.complianceStatus === "COMPLIANT";
      if (!isCompliant) {
        throw new AppError(
          "Driver is inactive or non-compliant",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      shouldCreateAssignment = true;
    } else {
      // Note: Job model requires driverId, but guide allows jobs without driver
      // For now, we'll find a placeholder driver (or make driverId optional in model)
      // In production, consider making driverId optional in Job model for DRAFT jobs
      const placeholderDriver = await Driver.findOne({
        isActive: true,
        driverStatus: "COMPLIANT",
      })
        .sort({ createdAt: 1 })
        .lean();

      if (!placeholderDriver) {
        // If no placeholder available, we'll need to handle this
        // For now, throw error - in production, make driverId optional in Job model
        throw new AppError(
          "No active drivers available. Please assign a driver to create a job, or contact support to set up a system driver.",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      driverId = placeholderDriver._id.toString();
      // Note: We use placeholder but won't create assignment or include in response
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

    // Create assignment if driverId was provided in request
    if (shouldCreateAssignment && driver) {
      await Assignment.create({
        jobId: job._id,
        driverId: new mongoose.Types.ObjectId(driverId),
        paperworkSmsRequested: false,
        organizationId: organizationId
          ? new mongoose.Types.ObjectId(organizationId)
          : null,
      });
    }

    // Populate customer with party for response
    const populatedCustomer = await Customer.findById(data.customerId)
      .populate({
        path: "partyId",
        model: "Party",
        select: "companyName firstName lastName email",
      })
      .lean();

    // Format response according to guide
    const responseData = {
      id: job._id.toString(),
      jobNumber: job.jobNumber,
      customerId: job.customerId.toString(),
      customer: populatedCustomer
        ? {
            id: populatedCustomer._id.toString(),
            partyId: populatedCustomer.partyId
              ? populatedCustomer.partyId._id.toString()
              : null,
            party: populatedCustomer.partyId
              ? {
                  id: populatedCustomer.partyId._id.toString(),
                  companyName: populatedCustomer.partyId.companyName || null,
                  firstName: populatedCustomer.partyId.firstName || null,
                  lastName: populatedCustomer.partyId.lastName || null,
                  email: populatedCustomer.partyId.email || null,
                }
              : null,
          }
        : null,
      jobType: data.jobType, // Return the original jobType (HOURLY or FTL)
      pickupSuburb: job.pickupSuburb || null,
      deliverySuburb: job.deliverySuburb || null,
      vehicleType: job.vehicleType || null,
      createdFrom: boardType, // Return as createdFrom for API consistency (PUD or LINEHAUL)
      serviceDate: serviceDate.toISOString(), // Return as ISO date
      status: shouldCreateAssignment ? "ASSIGNED" : "DRAFT", // Return status based on assignment
      organizationId: job.organizationId ? job.organizationId.toString() : null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };

    // Add driver details if driverId was provided in request
    if (shouldCreateAssignment && driver) {
      const party = driver.partyId;
      const fullName = party
        ? `${party.firstName || ""} ${party.lastName || ""}`.trim() || null
        : null;

      responseData.driverId = driver._id.toString();
      responseData.driver = {
        id: driver._id.toString(),
        driverCode: driver.driverCode || null,
        fullName: fullName,
        party: party
          ? {
              id: party._id.toString(),
              firstName: party.firstName || null,
              lastName: party.lastName || null,
              email: party.email || null,
              phone: party.phone || null,
              companyName: party.companyName || null,
            }
          : null,
      };
    } else {
      responseData.driverId = null;
      responseData.driver = null;
    }

    return responseData;
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

  /**
   * Get jobs by service date
   * @param {Object} query - Query parameters (date)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of job objects with populated relationships
   */
  static async getJobs(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate date parameter
    if (!query.date) {
      throw new AppError("Date parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.date)) {
      throw new AppError(
        "Invalid date format. Expected YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse date and validate
    const requestedDate = new Date(query.date + "T00:00:00.000Z");
    if (isNaN(requestedDate.getTime())) {
      throw new AppError("Invalid date", HttpStatusCodes.BAD_REQUEST);
    }

    // Build filter - Job model uses date (string, YYYY-MM-DD) instead of serviceDate
    const filter = {
      date: query.date, // Direct string comparison since date is stored as YYYY-MM-DD
    };

    // Filter by organization
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Query jobs with populated customer and party
    const jobs = await Job.find(filter)
      .populate({
        path: "customerId",
        model: "Customer",
        select: "partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "companyName firstName lastName email",
        },
      })
      .sort({ jobNumber: 1 })
      .lean();

    // Get all job IDs to fetch assignments (only if there are jobs)
    let assignments = [];
    let assignmentMap = new Map();
    if (jobs.length > 0) {
      const jobIds = jobs.map((job) => job._id);
      assignments = await Assignment.find({
        jobId: { $in: jobIds },
      }).lean();

      // Create a map of jobId -> assignment for quick lookup
      assignments.forEach((assignment) => {
        assignmentMap.set(assignment.jobId.toString(), assignment);
      });
    }

    // Map jobs to response format
    const mappedJobs = jobs.map((job) => {
      // Derive jobType from boardType
      const jobType = job.boardType === "LINEHAUL" ? "FTL" : "HOURLY";

      // Map status - Job model uses OPEN/CLOSED, guide expects DRAFT/ASSIGNED/IN_PROGRESS/CLOSED/CANCELED
      // For now, map OPEN -> ASSIGNED, CLOSED -> CLOSED
      // If job has assignment, it's ASSIGNED, otherwise DRAFT
      let status = "DRAFT";
      if (job.status === "CLOSED") {
        status = "CLOSED";
      } else if (assignmentMap.has(job._id.toString())) {
        status = "ASSIGNED";
      }

      // Get assignment if exists
      const assignment = assignmentMap.get(job._id.toString());

      // Convert serviceDate - Job model uses date (string), guide expects ISO date
      const serviceDate = new Date(job.date + "T00:00:00.000Z");

      // Build response object
      // Handle case where customerId might not be populated (shouldn't happen, but safety check)
      const customerId = job.customerId?._id || job.customerId;
      const customerIdStr = customerId ? customerId.toString() : null;
      const party = job.customerId?.partyId;

      const jobObj = {
        id: job._id.toString(),
        jobNumber: job.jobNumber,
        customerId: customerIdStr,
        customer: {
          id: customerIdStr,
          partyId: party ? (party._id ? party._id.toString() : party.toString()) : null,
          party: party
            ? {
                id: party._id ? party._id.toString() : party.toString(),
                companyName: party.companyName || null,
                firstName: party.firstName || null,
                lastName: party.lastName || null,
                email: party.email || null,
              }
            : null,
        },
        jobType: jobType,
        pickupSuburb: job.pickupSuburb || null,
        deliverySuburb: job.deliverySuburb || null,
        vehicleType: job.vehicleType || null,
        createdFrom: job.boardType, // Map boardType to createdFrom
        serviceDate: serviceDate.toISOString(),
        status: status,
        organizationId: job.organizationId ? job.organizationId.toString() : null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      };

      // Add assignment if exists
      if (assignment) {
        // Convert startTime/finishTime from HH:mm string to ISO date
        // Use the job's date and combine with time
        let startTimeISO = null;
        let finishTimeISO = null;

        if (job.startTime) {
          const [hours, minutes] = job.startTime.split(":");
          const startDateTime = new Date(job.date + `T${hours}:${minutes}:00.000Z`);
          startTimeISO = startDateTime.toISOString();
        }

        if (job.finishTime) {
          const [hours, minutes] = job.finishTime.split(":");
          const finishDateTime = new Date(job.date + `T${hours}:${minutes}:00.000Z`);
          finishTimeISO = finishDateTime.toISOString();
        }

        jobObj.assignment = {
          id: assignment._id.toString(),
          jobId: assignment.jobId.toString(),
          driverId: assignment.driverId.toString(),
          startTime: startTimeISO,
          finishTime: finishTimeISO,
          breakMinutes: 0, // Assignment model doesn't have breakMinutes, default to 0
          paperworkSmsRequested: assignment.paperworkSmsRequested || false,
          paperworkSmsRequestedAt: assignment.paperworkSmsSentAt
            ? assignment.paperworkSmsSentAt.toISOString()
            : null, // Use paperworkSmsSentAt as paperworkSmsRequestedAt
          createdAt: assignment.createdAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
        };
      }

      return jobObj;
    });

    return mappedJobs;
  }

  /**
   * Assign a driver to a job
   * @param {string} jobId - Job ID
   * @param {Object} data - Request data (driverId)
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated job object with assignment
   */
  static async assignDriver(jobId, data, user) {
    const errors = [];
    const organizationId = user.activeOrganizationId || null;

    // Validate driverId
    if (!data.driverId) {
      errors.push({
        field: "driverId",
        message: "Driver ID is required",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate driverId format
    if (!mongoose.Types.ObjectId.isValid(data.driverId)) {
      throw new AppError("Invalid driver ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate jobId format
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new AppError("Invalid job ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Build job filter
    const jobFilter = {
      _id: new mongoose.Types.ObjectId(jobId),
    };

    // Filter by organization
    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    // Validate job exists and belongs to organization
    const job = await Job.findOne(jobFilter).lean();

    if (!job) {
      throw new AppError("Job not found", HttpStatusCodes.NOT_FOUND);
    }

    // Verify job can be assigned (not CLOSED or CANCELED)
    // Job model uses OPEN/CLOSED, so we check for CLOSED
    if (job.status === "CLOSED") {
      throw new AppError(
        "Job cannot be assigned. Status must be DRAFT or ASSIGNED",
        HttpStatusCodes.CONFLICT
      );
    }

    // Validate driver exists and is active
    const driverFilter = {
      _id: new mongoose.Types.ObjectId(data.driverId),
    };

    // Note: Driver model may not have organizationId directly
    // For now, we'll validate driver exists and is active
    const driver = await Driver.findOne(driverFilter).lean();

    if (!driver) {
      throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
    }

    // Validate driver is active
    if (!driver.isActive) {
      throw new AppError(
        "Driver is inactive or non-compliant",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate driver is compliant
    const isCompliant =
      driver.driverStatus === "COMPLIANT" ||
      driver.complianceStatus === "COMPLIANT";
    if (!isCompliant) {
      throw new AppError(
        "Driver is inactive or non-compliant",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Check if assignment already exists
    const existingAssignment = await Assignment.findOne({
      jobId: new mongoose.Types.ObjectId(jobId),
    }).lean();

    let assignment;

    if (existingAssignment) {
      // Update existing assignment
      await Assignment.updateOne(
        { _id: existingAssignment._id },
        {
          $set: {
            driverId: new mongoose.Types.ObjectId(data.driverId),
            updatedAt: new Date(),
          },
        }
      );

      // Fetch updated assignment
      assignment = await Assignment.findById(existingAssignment._id).lean();
    } else {
      // Create new assignment
      assignment = await Assignment.create({
        jobId: new mongoose.Types.ObjectId(jobId),
        driverId: new mongoose.Types.ObjectId(data.driverId),
        paperworkSmsRequested: false,
        paperworkSmsSentAt: null,
        organizationId: organizationId
          ? new mongoose.Types.ObjectId(organizationId)
          : null,
      });
      assignment = assignment.toObject();
    }

    // Update job driverId and status
    await Job.updateOne(
      { _id: new mongoose.Types.ObjectId(jobId) },
      {
        $set: {
          driverId: new mongoose.Types.ObjectId(data.driverId),
          status: "OPEN", // Job model uses OPEN/CLOSED, but we'll return "ASSIGNED" in response
          updatedAt: new Date(),
        },
      }
    );

    // Fetch updated job with populated customer
    const updatedJob = await Job.findById(jobId)
      .populate({
        path: "customerId",
        model: "Customer",
        select: "partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "companyName firstName lastName email",
        },
      })
      .lean();

    // Derive jobType from boardType
    const jobType = updatedJob.boardType === "LINEHAUL" ? "FTL" : "HOURLY";

    // Convert serviceDate - Job model uses date (string), guide expects ISO date
    const serviceDate = new Date(updatedJob.date + "T00:00:00.000Z");

    // Format assignment response
    // Convert startTime/finishTime from Job's HH:mm strings to ISO dates if available
    let startTimeISO = null;
    let finishTimeISO = null;

    if (updatedJob.startTime) {
      const [hours, minutes] = updatedJob.startTime.split(":");
      const startDateTime = new Date(updatedJob.date + `T${hours}:${minutes}:00.000Z`);
      startTimeISO = startDateTime.toISOString();
    }

    if (updatedJob.finishTime) {
      const [hours, minutes] = updatedJob.finishTime.split(":");
      const finishDateTime = new Date(updatedJob.date + `T${hours}:${minutes}:00.000Z`);
      finishTimeISO = finishDateTime.toISOString();
    }

    // Format response
    const responseData = {
      id: updatedJob._id.toString(),
      jobNumber: updatedJob.jobNumber,
      customerId: updatedJob.customerId._id.toString(),
      customer: {
        id: updatedJob.customerId._id.toString(),
        partyId: updatedJob.customerId.partyId
          ? updatedJob.customerId.partyId._id.toString()
          : null,
        party: updatedJob.customerId.partyId
          ? {
              id: updatedJob.customerId.partyId._id.toString(),
              companyName: updatedJob.customerId.partyId.companyName || null,
              firstName: updatedJob.customerId.partyId.firstName || null,
              lastName: updatedJob.customerId.partyId.lastName || null,
              email: updatedJob.customerId.partyId.email || null,
            }
          : null,
      },
      jobType: jobType,
      pickupSuburb: updatedJob.pickupSuburb || null,
      deliverySuburb: updatedJob.deliverySuburb || null,
      vehicleType: updatedJob.vehicleType || null,
      createdFrom: updatedJob.boardType, // Map boardType to createdFrom
      serviceDate: serviceDate.toISOString(),
      status: "ASSIGNED", // Return as ASSIGNED for API consistency
      organizationId: updatedJob.organizationId
        ? updatedJob.organizationId.toString()
        : null,
      assignment: {
        id: assignment._id.toString(),
        jobId: assignment.jobId.toString(),
        driverId: assignment.driverId.toString(),
        startTime: startTimeISO,
        finishTime: finishTimeISO,
        breakMinutes: 0, // Assignment model doesn't have breakMinutes, default to 0
        paperworkSmsRequested: assignment.paperworkSmsRequested || false,
        paperworkSmsRequestedAt: assignment.paperworkSmsSentAt
          ? assignment.paperworkSmsSentAt.toISOString()
          : null, // Use paperworkSmsSentAt as paperworkSmsRequestedAt
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
      },
      createdAt: updatedJob.createdAt.toISOString(),
      updatedAt: updatedJob.updatedAt.toISOString(),
    };

    return responseData;
  }

  /**
   * Get jobs for close view with filtering
   * @param {Object} query - Query parameters (fromDate, toDate, customerId, driverId, status, serviceCode)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of job objects with populated relationships
   */
  static async getCloseViewJobs(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate date formats
    let fromDateFilter = null;
    let toDateFilter = null;

    if (query.fromDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(query.fromDate)) {
        throw new AppError(
          "Invalid fromDate format. Expected YYYY-MM-DD",
          HttpStatusCodes.BAD_REQUEST
        );
      }
      fromDateFilter = new Date(query.fromDate + "T00:00:00.000Z");
      if (isNaN(fromDateFilter.getTime())) {
        throw new AppError("Invalid fromDate", HttpStatusCodes.BAD_REQUEST);
      }
    }

    if (query.toDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(query.toDate)) {
        throw new AppError(
          "Invalid toDate format. Expected YYYY-MM-DD",
          HttpStatusCodes.BAD_REQUEST
        );
      }
      toDateFilter = new Date(query.toDate + "T23:59:59.999Z");
      if (isNaN(toDateFilter.getTime())) {
        throw new AppError("Invalid toDate", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Validate date range
    if (fromDateFilter && toDateFilter && toDateFilter < fromDateFilter) {
      throw new AppError(
        "toDate must be greater than or equal to fromDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build query filters
    const jobFilter = {};

    // Filter by organization
    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    // Date filter - Job model uses date (string, YYYY-MM-DD)
    if (fromDateFilter || toDateFilter) {
      if (fromDateFilter && toDateFilter) {
        // Both dates provided - filter by string comparison
        const fromDateStr = query.fromDate;
        const toDateStr = query.toDate;
        jobFilter.date = { $gte: fromDateStr, $lte: toDateStr };
      } else if (fromDateFilter) {
        jobFilter.date = { $gte: query.fromDate };
      } else if (toDateFilter) {
        jobFilter.date = { $lte: query.toDate };
      }
    }

    // Customer filter
    if (query.customerId) {
      if (!mongoose.Types.ObjectId.isValid(query.customerId)) {
        throw new AppError("Invalid customer ID format", HttpStatusCodes.BAD_REQUEST);
      }
      jobFilter.customerId = new mongoose.Types.ObjectId(query.customerId);
    }

    // Status filter - Job model uses OPEN/CLOSED, but guide expects READY_TO_CLOSE, etc.
    // Map guide statuses to model statuses
    if (query.status) {
      if (query.status === "CLOSED") {
        jobFilter.status = "CLOSED";
      } else if (query.status === "READY_TO_CLOSE" || query.status === "ASSIGNED" || query.status === "DRAFT") {
        // These map to OPEN in the model
        jobFilter.status = "OPEN";
      } else if (query.status === "OPEN") {
        jobFilter.status = "OPEN";
      } else {
        // For other statuses, try to match directly
        jobFilter.status = query.status;
      }
    }

    // Service code filter - get from allocatorRow
    let jobIdsWithServiceCode = null;
    if (query.serviceCode) {
      const allocatorRows = await AllocatorRow.find({
        serviceCode: query.serviceCode,
        organizationId: organizationId
          ? new mongoose.Types.ObjectId(organizationId)
          : null,
      })
        .select("jobId")
        .lean();

      jobIdsWithServiceCode = allocatorRows
        .map((row) => row.jobId)
        .filter((id) => id !== null);

      if (jobIdsWithServiceCode.length === 0) {
        // No jobs with this service code, return empty array
        return [];
      }

      jobFilter._id = { $in: jobIdsWithServiceCode };
    }

    // Driver filter (via assignment)
    let jobIdsWithDriver = null;
    if (query.driverId) {
      if (!mongoose.Types.ObjectId.isValid(query.driverId)) {
        throw new AppError("Invalid driver ID format", HttpStatusCodes.BAD_REQUEST);
      }

      const assignments = await Assignment.find({
        driverId: new mongoose.Types.ObjectId(query.driverId),
      })
        .select("jobId")
        .lean();

      jobIdsWithDriver = assignments.map((a) => a.jobId);

      if (jobIdsWithDriver.length === 0) {
        // No jobs with this driver, return empty array
        return [];
      }

      // Combine with existing _id filter if serviceCode filter exists
      if (jobFilter._id) {
        jobFilter._id.$in = jobFilter._id.$in.filter((id) =>
          jobIdsWithDriver.some((dId) => dId.toString() === id.toString())
        );
        if (jobFilter._id.$in.length === 0) {
          return [];
        }
      } else {
        jobFilter._id = { $in: jobIdsWithDriver };
      }
    }

    // Query jobs with populated customer
    const jobs = await Job.find(jobFilter)
      .populate({
        path: "customerId",
        model: "Customer",
        select: "partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "companyName firstName lastName email",
        },
      })
      .populate({
        path: "allocatorRowId",
        model: "AllocatorRow",
        select: "serviceCode ancillaryCharges",
      })
      .sort({ date: -1, jobNumber: 1 })
      .lean();

    // Get all job IDs to fetch assignments
    const jobIds = jobs.map((job) => job._id);
    const assignments = await Assignment.find({
      jobId: { $in: jobIds },
    })
      .populate({
        path: "driverId",
        model: "Driver",
        select: "driverCode partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "firstName lastName email phone companyName",
        },
      })
      .lean();

    // Create a map of jobId -> assignments for quick lookup
    const assignmentMap = new Map();
    assignments.forEach((assignment) => {
      const jobIdStr = assignment.jobId.toString();
      if (!assignmentMap.has(jobIdStr)) {
        assignmentMap.set(jobIdStr, []);
      }
      assignmentMap.get(jobIdStr).push(assignment);
    });

    // Map jobs to response format
    const formattedJobs = jobs.map((job) => {
      // Derive jobType from boardType
      const jobType = job.boardType === "LINEHAUL" ? "FTL" : "HOURLY";

      // Get assignments for this job
      const jobAssignments = assignmentMap.get(job._id.toString()) || [];

      // Get first assignment for convenience fields
      const firstAssignment = jobAssignments.length > 0 ? jobAssignments[0] : null;

      // Calculate hours for HOURLY jobs
      let hours = null;
      if (jobType === "HOURLY" && firstAssignment) {
        const startTime = firstAssignment.startTime
          ? new Date(firstAssignment.startTime)
          : null;
        const finishTime = firstAssignment.finishTime
          ? new Date(firstAssignment.finishTime)
          : null;

        if (startTime && finishTime) {
          const breakMins = firstAssignment.breakMinutes || 0;
          const totalMinutes = (finishTime - startTime) / (1000 * 60) - breakMins;
          hours = Math.max(0, totalMinutes / 60);
        }
      }

      // Get service code from allocatorRow
      const serviceCode = job.allocatorRowId?.serviceCode || null;

      // Get ancillary charges from allocatorRow
      const ancillaryCharges = job.allocatorRowId?.ancillaryCharges || [];

      // Format ancillary charges
      const formattedAncillaryCharges = ancillaryCharges.map((charge) => ({
        code: charge.code || "",
        name: charge.name || "",
        unitRate: charge.unitRate ? charge.unitRate.toString() : "0.00",
        quantity: charge.quantity ? charge.quantity.toString() : "1",
        amount: charge.amount ? charge.amount.toString() : "0.00",
        notes: charge.notes || null,
      }));

      // Calculate fuel levy percent
      const baseCharge = job.customerCharge || 0;
      const fuelLevy = job.fuelLevy || 0;
      const fuelLevyPercent =
        baseCharge > 0 ? ((fuelLevy / baseCharge) * 100).toFixed(2) : "0.00";

      // Convert serviceDate - Job model uses date (string), guide expects ISO date
      const serviceDate = new Date(job.date + "T00:00:00.000Z");

      // Format assignments
      const formattedAssignments = jobAssignments.map((assignment) => {
        const driver = assignment.driverId;
        const party = driver?.partyId;
        const fullName = party
          ? `${party.firstName || ""} ${party.lastName || ""}`.trim() || null
          : null;

        return {
          id: assignment._id.toString(),
          jobId: assignment.jobId.toString(),
          driverId: assignment.driverId._id.toString(),
          driver: driver
            ? {
                id: driver._id.toString(),
                driverCode: driver.driverCode || null,
                fullName: fullName,
                party: party
                  ? {
                      id: party._id.toString(),
                      firstName: party.firstName || null,
                      lastName: party.lastName || null,
                      email: party.email || null,
                      phone: party.phone || null,
                      companyName: party.companyName || null,
                    }
                  : null,
              }
            : null,
          startTime: assignment.startTime
            ? assignment.startTime.toISOString()
            : null,
          finishTime: assignment.finishTime
            ? assignment.finishTime.toISOString()
            : null,
          breakMinutes: assignment.breakMinutes || 0,
        };
      });

      // Get assignment times for convenience (from first assignment)
      const startTimeISO = firstAssignment?.startTime
        ? firstAssignment.startTime.toISOString()
        : null;
      const finishTimeISO = firstAssignment?.finishTime
        ? firstAssignment.finishTime.toISOString()
        : null;
      const breakMinutes = firstAssignment?.breakMinutes || 0;

      // Map status - Job model uses OPEN/CLOSED, guide expects READY_TO_CLOSE, etc.
      let status = job.status;
      if (job.status === "OPEN" && jobAssignments.length > 0) {
        status = "READY_TO_CLOSE"; // If job is OPEN and has assignment, it's ready to close
      }

      return {
        id: job._id.toString(),
        jobNumber: job.jobNumber,
        customerId: job.customerId._id.toString(),
        customer: {
          id: job.customerId._id.toString(),
          companyName: job.customerId.partyId?.companyName || null,
          firstName: job.customerId.partyId?.firstName || null,
          lastName: job.customerId.partyId?.lastName || null,
          email: job.customerId.partyId?.email || null,
        },
        jobType: jobType,
        pickupSuburb: job.pickupSuburb || null,
        deliverySuburb: job.deliverySuburb || null,
        vehicleType: job.vehicleType || null,
        createdFrom: job.boardType, // Map boardType to createdFrom
        serviceDate: serviceDate.toISOString(),
        status: status,
        organizationId: job.organizationId ? job.organizationId.toString() : null,
        serviceCode: serviceCode,
        baseCharge: baseCharge.toFixed(2), // Convert to string with 2 decimals
        fuelLevyPercent: fuelLevyPercent,
        driverPayAmount: (job.driverPay || 0).toFixed(2), // Convert to string with 2 decimals
        hours: hours,
        startTime: startTimeISO,
        finishTime: finishTimeISO,
        breakMinutes: breakMinutes,
        assignments: formattedAssignments,
        ancillaryCharges: formattedAncillaryCharges,
        surcharges: [], // Job model doesn't have surcharges, return empty array
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      };
    });

    return formattedJobs;
  }

  /**
   * Close a job and create AR/AP entries
   * @param {string} jobId - Job ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Closed job with AR/AP entry details
   */
  static async closeJob(jobId, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate jobId format
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new AppError("Invalid job ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Start database transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Build job filter
      const jobFilter = {
        _id: new mongoose.Types.ObjectId(jobId),
      };

      if (organizationId) {
        jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
      } else {
        jobFilter.organizationId = null;
      }

      // Validate job exists and belongs to organization
      const job = await Job.findOne(jobFilter).session(session);

      if (!job) {
        await session.abortTransaction();
        throw new AppError("Job not found", HttpStatusCodes.NOT_FOUND);
      }

      // Verify job can be closed
      if (job.status === "CLOSED") {
        await session.abortTransaction();
        throw new AppError("Job is already closed", HttpStatusCodes.BAD_REQUEST);
      }

      // Check if job is ready to close (OPEN with assignment maps to READY_TO_CLOSE)
      if (job.status !== "OPEN") {
        await session.abortTransaction();
        throw new AppError(
          "Job cannot be closed. Status must be READY_TO_CLOSE",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Verify job has assignment
      const assignment = await Assignment.findOne({
        jobId: new mongoose.Types.ObjectId(jobId),
      }).session(session);

      if (!assignment || !assignment.driverId) {
        await session.abortTransaction();
        throw new AppError(
          "Job must have an assignment before it can be closed",
          HttpStatusCodes.CONFLICT
        );
      }

      // Update job status
      const closedAt = new Date();
      job.status = "CLOSED";
      job.closedAt = closedAt;
      job.updatedAt = closedAt;
      await job.save({ session });

      // Get service code from allocatorRow if available
      let serviceCode = null;
      if (job.allocatorRowId) {
        const allocatorRow = await AllocatorRow.findById(job.allocatorRowId)
          .select("serviceCode")
          .lean();
        serviceCode = allocatorRow?.serviceCode || null;
      }

      // Format description for AR entry: "{serviceCode} - {YYYY-MM-DD}"
      const serviceDate = job.date; // Job model uses date as string (YYYY-MM-DD)
      const description = serviceCode
        ? `${serviceCode} - ${serviceDate}`
        : `${job.jobNumber} - ${serviceDate}`;

      // Calculate amounts
      const baseCharge = job.customerCharge || 0;
      const fuelLevy = job.fuelLevy || 0;
      const fuelLevyPercent =
        baseCharge > 0 ? ((fuelLevy / baseCharge) * 100).toFixed(2) : "0.00";
      const driverPayAmount = job.driverPay || 0;

      // Get surcharges from allocatorRow if available
      let surcharges = [];
      if (job.allocatorRowId) {
        const allocatorRow = await AllocatorRow.findById(job.allocatorRowId)
          .select("surcharges")
          .lean();
        surcharges = allocatorRow?.surcharges || [];
      }

      // Create AR Entry (Invoice Draft Line)
      const arEntry = await InvoiceDraftLine.create(
        [
          {
            customerId: job.customerId,
            jobId: job._id,
            invoiceId: null, // NULL until attached to an invoice
            description: description,
            qty: 1,
            rate: baseCharge.toFixed(2),
            fuelPercent: fuelLevyPercent,
            surcharges: surcharges,
            amountExGst: baseCharge.toFixed(2), // Fuel added at invoice calculation time
            organizationId: organizationId
              ? new mongoose.Types.ObjectId(organizationId)
              : null,
            createdAt: closedAt,
            updatedAt: closedAt,
          },
        ],
        { session }
      );

      // Create AP Entry (Driver Payrun Item)
      const apEntry = await PayRunItem.create(
        [
          {
            payrunId: null, // NULL until attached to a pay run
            driverId: assignment.driverId,
            jobId: job._id,
            kind: "JOB",
            description: "Job pay",
            amount: driverPayAmount,
            excluded: false,
            createdAt: closedAt,
            updatedAt: closedAt,
          },
        ],
        { session }
      );

      // Commit transaction
      await session.commitTransaction();

      // Format response
      const responseData = {
        id: job._id.toString(),
        jobNumber: job.jobNumber,
        status: job.status,
        closedAt: closedAt.toISOString(),
        arEntry: {
          id: arEntry[0]._id.toString(),
          customerId: arEntry[0].customerId.toString(),
          jobId: arEntry[0].jobId.toString(),
          description: arEntry[0].description,
          amount: arEntry[0].amountExGst,
        },
        apEntry: {
          id: apEntry[0]._id.toString(),
          driverId: apEntry[0].driverId.toString(),
          jobId: apEntry[0].jobId.toString(),
          amount: apEntry[0].amount.toString(),
        },
        message: "Job closed successfully. AR and AP entries created.",
      };

      return responseData;
    } catch (error) {
      // Rollback transaction on any error
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

module.exports = JobService;

