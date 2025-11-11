const AllocatorRow = require("../models/allocatorRow.model");
const Job = require("../models/job.model");
const Assignment = require("../models/assignment.model");
const Attachment = require("../models/attachment.model");
const DriverUsage = require("../models/driverUsage.model");
const AllocatorPreferences = require("../models/allocatorPreferences.model");
const Availability = require("../models/availability.model");
const Customer = require("../models/customer.model");
const Driver = require("../models/driver.model");
const VehicleType = require("../models/vehicleType.model");
const Party = require("../models/party.model");
const Ancillary = require("../models/ancillary.model");
const RateCard = require("../models/rateCard.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");
const { uploadFileToS3 } = require("./aws.service");

class AllocatorService {
  // ==================== ALLOCATOR ROWS ====================

  /**
   * Get allocator rows for a date range
   * @param {Object} query - Query parameters (startDate, endDate, boardType)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of allocator rows with enriched data
   */
  static async getRowsByRange(query, user) {
    const { startDate, endDate, boardType } = query;

    // Validate required parameters
    if (!startDate || !endDate || !boardType) {
      throw new AppError(
        "startDate, endDate, and boardType are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate boardType
    if (!["PUD", "LINEHAUL"].includes(boardType)) {
      throw new AppError(
        "boardType must be 'PUD' or 'LINEHAUL'",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build filter
    const filter = {
      date: { $gte: startDate, $lte: endDate },
      boardType,
    };

    // Add organization filter if user has organization
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    // Fetch rows
    const rows = await AllocatorRow.find(filter)
      .populate("customerId", "partyId")
      .populate("driverId", "partyId defaultVehicleType")
      .sort({ date: 1, createdAt: 1 })
      .lean();

    // Enrich rows with assignment and job data
    const enrichedRows = await Promise.all(
      rows.map(async (row) => {
        const enriched = { ...row };

        // Add assignment data if job exists
        if (row.jobId) {
          const assignment = await Assignment.findOne({
            jobId: row.jobId,
          }).lean();

          if (assignment) {
            enriched.assignment = {
              id: assignment._id.toString(),
              paperworkSmsRequested: assignment.paperworkSmsRequested || false,
            };
          }

          // Add job data
          const job = await Job.findById(row.jobId).lean();
          if (job) {
            enriched.job = {
              id: job._id.toString(),
              status: job.status,
              jobNumber: job.jobNumber,
            };
          }
        }

        // Format response
        return {
          id: row._id.toString(),
          date: row.date,
          boardType: row.boardType,
          status: row.status,
          customerId: row.customerId ? row.customerId._id.toString() : null,
          driverId: row.driverId ? row.driverId._id.toString() : null,
          vehicleType: row.vehicleType,
          pickupSuburb: row.pickupSuburb,
          deliverySuburb: row.deliverySuburb,
          startTime: row.startTime,
          finishTime: row.finishTime,
          notes: row.notes,
          jobStatus: row.jobStatus,
          driverPay: row.driverPay,
          customerCharge: row.customerCharge,
          fuelLevy: row.fuelLevy,
          pickupTime: row.pickupTime,
          deliveryDate: row.deliveryDate,
          deliveryTime: row.deliveryTime,
          jobNumber: row.jobNumber,
          jobId: row.jobId ? row.jobId.toString() : null,
          ancillaryCharges: row.ancillaryCharges || null,
          driverFullName: row.driverFullName,
          code: row.code,
          assignment: enriched.assignment || null,
          job: enriched.job || null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
    );

    return enrichedRows;
  }

  /**
   * Create a new allocator row
   * @param {Object} data - Row data
   * @param {Object} user - Authenticated user
   * @returns {Object} Created row with warnings
   */
  static async createRow(data, user) {
    // Set defaults
    const rowData = {
      date: data.date,
      boardType: data.boardType || "PUD",
      status: data.status || "Draft",
      customerId: data.customerId || null,
      driverId: data.driverId || null,
      vehicleType: data.vehicleType || null,
      pickupSuburb: data.pickupSuburb || null,
      deliverySuburb: data.deliverySuburb || null,
      startTime: data.startTime || null,
      finishTime: data.finishTime || null,
      notes: data.notes || null,
      jobStatus: data.jobStatus || null,
      driverPay: data.driverPay || null,
      customerCharge: data.customerCharge || null,
      fuelLevy: data.fuelLevy || null,
      pickupTime: data.pickupTime || null,
      deliveryDate: data.deliveryDate || null,
      deliveryTime: data.deliveryTime || null,
      ancillaryCharges: data.ancillaryCharges || [],
      organizationId: user.activeOrganizationId || null,
    };

    // Auto-populate driver details if driverId is provided
    if (data.driverId) {
      const driver = await Driver.findById(data.driverId).populate("party").lean();
      if (driver) {
        rowData.driverFullName = driver.party
          ? `${driver.party.firstName || ""} ${driver.party.lastName || ""}`.trim() ||
            driver.party.companyName
          : null;
        rowData.code = driver.party?.code || driver.driverCode || null;
        // Use first vehicle type from fleet if available, or keep provided vehicleType
        rowData.vehicleType = data.vehicleType || 
                             (driver.vehicleTypesInFleet && driver.vehicleTypesInFleet.length > 0 
                               ? driver.vehicleTypesInFleet[0] 
                               : rowData.vehicleType);
      }
    }

    // Create row
    const row = await AllocatorRow.create(rowData);

    // Run validation and collect warnings
    const warnings = this.validateRow(row);

    return {
      row: await this.formatRow(row),
      warnings,
    };
  }

  /**
   * Update an existing allocator row
   * @param {string} id - Row ID
   * @param {Object} data - Partial row data
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated row with warnings
   */
  static async updateRow(id, data, user) {
    const row = await AllocatorRow.findById(id);

    if (!row) {
      throw new AppError("Allocator row not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if row is locked
    if (row.status === "Locked") {
      throw new AppError(
        "Cannot update locked row",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Strip assignment metadata (it's enriched, not persisted)
    const updateData = { ...data };
    delete updateData.assignment;
    delete updateData.job;

    // Auto-update related fields if driverId changes
    if (data.driverId !== undefined && data.driverId !== row.driverId?.toString()) {
      if (data.driverId) {
        const driver = await Driver.findById(data.driverId).populate("party").lean();
        if (driver) {
          updateData.driverFullName = driver.party
            ? `${driver.party.firstName || ""} ${driver.party.lastName || ""}`.trim() ||
              driver.party.companyName
            : null;
          updateData.code = driver.party?.code || driver.driverCode || null;
          // Use first vehicle type from fleet if available, or keep existing
          if (!data.vehicleType) {
            updateData.vehicleType = (driver.vehicleTypesInFleet && driver.vehicleTypesInFleet.length > 0)
              ? driver.vehicleTypesInFleet[0]
              : row.vehicleType;
          }
        }
      } else {
        updateData.driverFullName = null;
        updateData.code = null;
      }
    }

    // Update row
    Object.assign(row, updateData);
    await row.save();

    // Run validation and collect warnings
    const warnings = this.validateRow(row);

    return {
      ...(await this.formatRow(row)),
      warnings,
    };
  }

  /**
   * Lock a row and create a job
   * @param {string} id - Row ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Job number and ID with warnings
   */
  static async lockRow(id, user) {
    const row = await AllocatorRow.findById(id)
      .populate("customerId")
      .populate("driverId");

    if (!row) {
      throw new AppError("Allocator row not found", HttpStatusCodes.NOT_FOUND);
    }

    if (row.status === "Locked") {
      throw new AppError("Row is already locked", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate required fields
    if (!row.customerId) {
      throw new AppError(
        "Customer assignment is required to lock row",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!row.driverId) {
      throw new AppError(
        "Driver assignment is required to lock row",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!row.date) {
      throw new AppError(
        "Date is required to lock row",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Generate unique job number
    const jobNumber = await this.generateJobNumber();

    // Create job
    const job = await Job.create({
      jobNumber,
      status: "OPEN",
      customerId: row.customerId._id,
      driverId: row.driverId._id,
      vehicleType: row.vehicleType,
      pickupSuburb: row.pickupSuburb,
      deliverySuburb: row.deliverySuburb,
      startTime: row.startTime,
      finishTime: row.finishTime,
      notes: row.notes,
      jobStatus: row.jobStatus,
      driverPay: row.driverPay,
      customerCharge: row.customerCharge,
      fuelLevy: row.fuelLevy,
      pickupTime: row.pickupTime,
      deliveryDate: row.deliveryDate,
      deliveryTime: row.deliveryTime,
      date: row.date,
      boardType: row.boardType,
      allocatorRowId: row._id,
      organizationId: user.activeOrganizationId || null,
    });

    // Create assignment
    await Assignment.create({
      jobId: job._id,
      driverId: row.driverId._id,
      paperworkSmsRequested: false,
      organizationId: user.activeOrganizationId || null,
    });

    // Update row
    row.status = "Locked";
    row.jobNumber = jobNumber;
    row.jobId = job._id;
    await row.save();

    // Run validation and collect warnings
    const warnings = this.validateRow(row);

    return {
      jobNumber,
      jobId: job._id.toString(),
      warnings,
    };
  }

  /**
   * Unlock a row (only if job is not CLOSED)
   * @param {string} id - Row ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async unlockRow(id, user) {
    const row = await AllocatorRow.findById(id);

    if (!row) {
      throw new AppError("Allocator row not found", HttpStatusCodes.NOT_FOUND);
    }

    if (row.status !== "Locked") {
      throw new AppError("Row is not locked", HttpStatusCodes.BAD_REQUEST);
    }

    // Check if job is CLOSED
    if (row.jobId) {
      const job = await Job.findById(row.jobId);
      if (job && job.status === "CLOSED") {
        throw new AppError(
          "Cannot unlock row with closed job",
          HttpStatusCodes.FORBIDDEN
        );
      }

      // Delete assignment
      await Assignment.deleteMany({ jobId: row.jobId });

      // Delete job
      await Job.findByIdAndDelete(row.jobId);
    }

    // Update row
    row.status = "Draft";
    row.jobNumber = null;
    row.jobId = null;
    await row.save();

    return {
      success: true,
      message: "Row unlocked successfully",
    };
  }

  /**
   * Generate unique job number
   * @returns {string} Job number
   */
  static async generateJobNumber() {
    const year = new Date().getFullYear();
    const prefix = `JOB-${year}-`;
    
    // Find the highest job number for this year
    const lastJob = await Job.findOne({
      jobNumber: { $regex: `^${prefix}` },
    })
      .sort({ jobNumber: -1 })
      .lean();

    let sequence = 1;
    if (lastJob) {
      const lastSequence = parseInt(lastJob.jobNumber.split("-")[2] || "0", 10);
      sequence = lastSequence + 1;
    }

    return `${prefix}${String(sequence).padStart(3, "0")}`;
  }

  /**
   * Validate row and return warnings
   * @param {Object} row - Allocator row
   * @returns {Array} Array of warning messages
   */
  static validateRow(row) {
    const warnings = [];

    if (!row.customerId) {
      warnings.push("Missing customer assignment");
    }

    if (!row.driverId) {
      warnings.push("Missing driver assignment");
    }

    if (!row.vehicleType) {
      warnings.push("Missing vehicle type");
    }

    if (!row.pickupSuburb && !row.deliverySuburb) {
      warnings.push("Missing pickup or delivery location");
    }

    // Check if date is in the past (for new rows)
    if (row.status === "Draft" && row.date) {
      const rowDate = new Date(row.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (rowDate < today) {
        warnings.push("Date is in the past");
      }
    }

    return warnings;
  }

  /**
   * Format row for response
   * @param {Object} row - Allocator row
   * @returns {Object} Formatted row
   */
  static async formatRow(row) {
    const formatted = {
      id: row._id.toString(),
      date: row.date,
      boardType: row.boardType,
      status: row.status,
      customerId: row.customerId ? row.customerId.toString() : null,
      driverId: row.driverId ? row.driverId.toString() : null,
      vehicleType: row.vehicleType,
      pickupSuburb: row.pickupSuburb,
      deliverySuburb: row.deliverySuburb,
      startTime: row.startTime,
      finishTime: row.finishTime,
      notes: row.notes,
      jobStatus: row.jobStatus,
      driverPay: row.driverPay,
      customerCharge: row.customerCharge,
      fuelLevy: row.fuelLevy,
      pickupTime: row.pickupTime,
      deliveryDate: row.deliveryDate,
      deliveryTime: row.deliveryTime,
      jobNumber: row.jobNumber,
      jobId: row.jobId ? row.jobId.toString() : null,
      ancillaryCharges: row.ancillaryCharges || null,
      driverFullName: row.driverFullName,
      code: row.code,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    // Enrich with assignment and job if locked
    if (row.jobId) {
      const assignment = await Assignment.findOne({ jobId: row.jobId }).lean();
      if (assignment) {
        formatted.assignment = {
          id: assignment._id.toString(),
          paperworkSmsRequested: assignment.paperworkSmsRequested || false,
        };
      }

      const job = await Job.findById(row.jobId).lean();
      if (job) {
        formatted.job = {
          id: job._id.toString(),
          status: job.status,
          jobNumber: job.jobNumber,
        };
      }
    }

    return formatted;
  }

  // ==================== BATCH OPERATIONS ====================

  /**
   * Lock multiple rows
   * @param {Array} ids - Array of row IDs
   * @param {Object} user - Authenticated user
   * @returns {Array} Results for each row
   */
  static async lockBatch(ids, user) {
    const results = [];

    for (const id of ids) {
      try {
        const result = await this.lockRow(id, user);
        results.push({
          id,
          jobNumber: result.jobNumber,
          jobId: result.jobId,
          success: true,
        });
      } catch (error) {
        results.push({
          id,
          error: error.message,
          success: false,
        });
      }
    }

    return { results };
  }

  /**
   * Unlock multiple rows
   * @param {Array} ids - Array of row IDs
   * @param {Object} user - Authenticated user
   * @returns {Array} Results for each row
   */
  static async unlockBatch(ids, user) {
    const results = [];

    for (const id of ids) {
      try {
        await this.unlockRow(id, user);
        results.push({
          id,
          success: true,
        });
      } catch (error) {
        results.push({
          id,
          error: error.message,
          success: false,
        });
      }
    }

    return { results };
  }

  /**
   * Delete multiple rows
   * @param {Array} ids - Array of row IDs
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message and count
   */
  static async deleteBatch(ids, user) {
    let deletedCount = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const row = await AllocatorRow.findById(id);

        if (!row) {
          errors.push(`Row ${id} not found`);
          continue;
        }

        // Check if row has closed job
        if (row.jobId) {
          const job = await Job.findById(row.jobId);
          if (job && job.status === "CLOSED") {
            errors.push(`Cannot delete row ${id} with closed job`);
            continue;
          }

          // Delete assignment
          await Assignment.deleteMany({ jobId: row.jobId });

          // Delete job
          await Job.findByIdAndDelete(row.jobId);
        }

        // Delete attachments
        await Attachment.deleteMany({ allocatorRowId: row._id });

        // Delete row
        await AllocatorRow.findByIdAndDelete(id);
        deletedCount++;
      } catch (error) {
        errors.push(`Error deleting row ${id}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      throw new AppError(
        `Some rows could not be deleted: ${errors.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    return {
      success: true,
      message: "Rows deleted successfully",
      deletedCount,
    };
  }

  // ==================== MASTER DATA ====================

  /**
   * Get eligible customers (excludes banned and stop-trade)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of customer objects
   */
  static async getEligibleCustomers(user) {
    const filter = {
      isActive: true, // Only return active customers
      // Note: If BANNED/STOP_TRADE statuses are needed, add status field to Customer model
    };

    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const customers = await Customer.find(filter)
      .populate("partyId")
      .sort({ "partyId.companyName": 1, "partyId.firstName": 1 })
      .lean();

    return customers.map((customer) => ({
      id: customer._id.toString(),
      partyId: customer.partyId?._id.toString() || null,
      party: customer.partyId
        ? {
            id: customer.partyId._id.toString(),
            companyName: customer.partyId.companyName || null,
            firstName: customer.partyId.firstName || null,
            lastName: customer.partyId.lastName || null,
          }
        : null,
    }));
  }

  /**
   * Get all drivers
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of driver objects
   */
  static async getAllDrivers(user) {
    const filter = { isActive: true };

    const drivers = await Driver.find(filter)
      .populate("partyId")
      .sort({ "partyId.companyName": 1, "partyId.firstName": 1 })
      .lean();

    return drivers.map((driver) => ({
      id: driver._id.toString(),
      partyId: driver.partyId?._id.toString() || null,
      defaultVehicleType: (driver.vehicleTypesInFleet && driver.vehicleTypesInFleet.length > 0)
        ? driver.vehicleTypesInFleet[0]
        : null,
      party: driver.partyId
        ? {
            id: driver.partyId._id.toString(),
            code: driver.partyId.code || driver.driverCode || null,
            companyName: driver.partyId.companyName || null,
            firstName: driver.partyId.firstName || null,
            lastName: driver.partyId.lastName || null,
          }
        : null,
    }));
  }

  /**
   * Get all vehicle types
   * @returns {Array} Array of vehicle type objects
   */
  static async getVehicleTypes() {
    const vehicleTypes = await VehicleType.find({})
      .sort({ sortOrder: 1, code: 1 })
      .lean();

    return vehicleTypes.map((vt) => ({
      id: vt._id.toString(),
      code: vt.code,
      fullName: vt.fullName,
      sortOrder: vt.sortOrder || 0,
    }));
  }

  // ==================== JOB MANAGEMENT ====================

  /**
   * Get job by ID
   * @param {string} id - Job ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Job object with all related data
   */
  static async getJobById(id, user) {
    const job = await Job.findById(id)
      .populate("customerId")
      .populate("driverId")
      .populate("allocatorRowId")
      .lean();

    if (!job) {
      throw new AppError("Job not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get assignment
    const assignment = await Assignment.findOne({ jobId: id }).lean();

    return {
      id: job._id.toString(),
      jobNumber: job.jobNumber,
      status: job.status,
      customerId: job.customerId?._id.toString() || null,
      driverId: job.driverId?._id.toString() || null,
      vehicleType: job.vehicleType,
      pickupSuburb: job.pickupSuburb,
      deliverySuburb: job.deliverySuburb,
      startTime: job.startTime,
      finishTime: job.finishTime,
      notes: job.notes,
      jobStatus: job.jobStatus,
      driverPay: job.driverPay,
      customerCharge: job.customerCharge,
      fuelLevy: job.fuelLevy,
      pickupTime: job.pickupTime,
      deliveryDate: job.deliveryDate,
      deliveryTime: job.deliveryTime,
      date: job.date,
      boardType: job.boardType,
      assignment: assignment
        ? {
            id: assignment._id.toString(),
            paperworkSmsRequested: assignment.paperworkSmsRequested || false,
          }
        : null,
      customer: job.customerId
        ? {
            id: job.customerId._id.toString(),
            partyId: job.customerId.partyId?.toString() || null,
          }
        : null,
      driver: job.driverId
        ? {
            id: job.driverId._id.toString(),
            partyId: job.driverId.partyId?.toString() || null,
          }
        : null,
    };
  }

  // ==================== ATTACHMENTS ====================

  /**
   * Get attachments for an allocator row
   * @param {string} rowId - Allocator row ID
   * @returns {Array} Array of attachment objects
   */
  static async getAttachments(rowId) {
    const attachments = await Attachment.find({ allocatorRowId: rowId })
      .sort({ createdAt: -1 })
      .lean();

    return attachments.map((att) => ({
      id: att._id.toString(),
      fileName: att.fileName,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
      uploadedAt: att.createdAt,
      url: att.fileUrl,
    }));
  }

  /**
   * Upload attachment to allocator row
   * @param {string} rowId - Allocator row ID
   * @param {Object} file - File object from multer
   * @param {Object} user - Authenticated user
   * @returns {Object} Attachment object
   */
  static async uploadAttachment(rowId, file, user) {
    const row = await AllocatorRow.findById(rowId);

    if (!row) {
      throw new AppError("Allocator row not found", HttpStatusCodes.NOT_FOUND);
    }

    if (row.status === "Locked") {
      throw new AppError(
        "Cannot upload attachment to locked row",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new AppError(
        "File size exceeds 10MB limit",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      throw new AppError(
        "Invalid file type. Only PDF, images, and documents are allowed",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Upload to S3
    const base64File = file.buffer.toString("base64");
    const dataUrl = `data:${file.mimetype};base64,${base64File}`;
    const uploadResult = await uploadFileToS3(dataUrl, file.mimetype);

    if (!uploadResult.success) {
      throw new AppError(
        "Failed to upload file",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    // Create attachment record
    const attachment = await Attachment.create({
      allocatorRowId: row._id,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      fileUrl: uploadResult.url,
      uploadedBy: user.id,
      organizationId: user.activeOrganizationId || null,
    });

    return {
      id: attachment._id.toString(),
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      uploadedAt: attachment.createdAt,
      url: attachment.fileUrl,
    };
  }

  /**
   * Delete attachment
   * @param {string} id - Attachment ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async deleteAttachment(id, user) {
    const attachment = await Attachment.findById(id).populate("allocatorRowId");

    if (!attachment) {
      throw new AppError("Attachment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if row is locked
    if (attachment.allocatorRowId && attachment.allocatorRowId.status === "Locked") {
      throw new AppError(
        "Cannot delete attachment from locked row",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Delete from S3 (if needed - implement based on your S3 setup)
    // await deleteFileFromS3(attachment.fileUrl);

    // Delete record
    await Attachment.findByIdAndDelete(id);

    return {
      success: true,
      message: "Attachment deleted",
    };
  }

  // ==================== USER PREFERENCES ====================

  /**
   * Get user preferences for a board type
   * @param {string} boardType - Board type (PUD or LINEHAUL)
   * @param {Object} user - Authenticated user
   * @returns {Object} Preferences object
   */
  static async getPreferences(boardType, user) {
    const preferences = await AllocatorPreferences.findOne({
      userId: user.id,
      boardType,
    }).lean();

    if (!preferences) {
      // Return default preferences
      return {
        boardType,
        columnVisibility: {},
        columnOrder: [],
        zoom: 1.0,
      };
    }

    return {
      boardType: preferences.boardType,
      columnVisibility: preferences.columnVisibility || {},
      columnOrder: preferences.columnOrder || [],
      zoom: preferences.zoom || 1.0,
    };
  }

  /**
   * Save user preferences for a board type
   * @param {string} boardType - Board type (PUD or LINEHAUL)
   * @param {Object} data - Preferences data
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async savePreferences(boardType, data, user) {
    const preferences = await AllocatorPreferences.findOne({
      userId: user.id,
      boardType,
    });

    if (preferences) {
      // Update existing preferences (merge)
      if (data.columnVisibility) {
        preferences.columnVisibility = {
          ...preferences.columnVisibility,
          ...data.columnVisibility,
        };
      }
      if (data.columnOrder) {
        preferences.columnOrder = data.columnOrder;
      }
      if (data.zoom !== undefined) {
        preferences.zoom = data.zoom;
      }
      await preferences.save();
    } else {
      // Create new preferences
      await AllocatorPreferences.create({
        userId: user.id,
        boardType,
        columnVisibility: data.columnVisibility || {},
        columnOrder: data.columnOrder || [],
        zoom: data.zoom || 1.0,
      });
    }

    return {
      success: true,
      message: "Preferences saved",
    };
  }

  // ==================== ANCILLARIES ====================

  /**
   * Get all ancillaries
   * @returns {Array} Array of ancillary objects
   */
  static async getAncillaries() {
    const ancillaries = await Ancillary.find({ isActive: true })
      .sort({ code: 1 })
      .lean();

    return ancillaries.map((anc) => ({
      id: anc._id.toString(),
      code: anc.code,
      name: anc.name,
      isActive: anc.isActive,
    }));
  }

  /**
   * Get rate cards for a customer
   * @param {string} customerId - Customer ID
   * @returns {Array} Array of rate card objects
   */
  static async getCustomerRateCards(customerId) {
    const rateCards = await RateCard.find({ customerId })
      .sort({ effectiveFrom: -1 })
      .lean();

    return rateCards.map((rc) => ({
      id: rc._id.toString(),
      customerId: rc.customerId ? rc.customerId.toString() : null,
      isActive: !rc.isLocked, // Use isLocked to determine if active
      effectiveDate: rc.effectiveFrom,
      expiryDate: rc.effectiveTo || null,
      rateType: rc.rateType,
      vehicleType: rc.vehicleType,
      serviceCode: rc.serviceCode || null,
      laneKey: rc.laneKey || null,
    }));
  }

  /**
   * Get ancillary lines from a rate card
   * @param {string} rateCardId - Rate card ID
   * @returns {Array} Array of ancillary line objects
   * 
   * Note: Current RateCard model doesn't have ancillaryLines field.
   * This method returns empty array for now. If ancillary lines are stored
   * in a separate model or added to RateCard, update this method accordingly.
   */
  static async getRateCardAncillaryLines(rateCardId) {
    const rateCard = await RateCard.findById(rateCardId).lean();

    if (!rateCard) {
      throw new AppError("Rate card not found", HttpStatusCodes.NOT_FOUND);
    }

    // TODO: Implement when ancillary lines are added to RateCard model or separate model is created
    // For now, return empty array
    return [];
    
    // Future implementation when ancillaryLines field is added:
    // return (rateCard.ancillaryLines || []).map((line) => ({
    //   id: line._id?.toString() || null,
    //   rateCardId: rateCard._id.toString(),
    //   ancillaryCode: line.ancillaryCode,
    //   unitRate: line.unitRate,
    //   notes: line.notes || null,
    // }));
  }

  // ==================== DRIVER USAGE ====================

  /**
   * Track driver usage
   * @param {Object} data - Usage data (driverId, boardType)
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async trackDriverUsage(data, user) {
    await DriverUsage.create({
      driverId: data.driverId,
      boardType: data.boardType,
      assignedAt: new Date(),
      organizationId: user.activeOrganizationId || null,
    });

    return {
      success: true,
      message: "Usage tracked",
    };
  }

  // ==================== AVAILABILITY ====================

  /**
   * Get driver availability for a date
   * @param {string} date - ISO date string (YYYY-MM-DD)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of availability objects
   */
  static async getAvailability(date, user) {
    if (!date) {
      throw new AppError("date query parameter is required", HttpStatusCodes.BAD_REQUEST);
    }

    const filter = { date };

    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    }

    const availabilities = await Availability.find(filter)
      .populate("driverId", "partyId")
      .sort({ createdAt: -1 })
      .lean();

    return availabilities.map((avail) => ({
      id: avail._id.toString(),
      driverId: avail.driverId?._id.toString() || null,
      date: avail.date,
      vehicleType: avail.vehicleType,
      bodyType: avail.bodyType,
      currentLocation: avail.currentLocation,
      destinationWanted: avail.destinationWanted,
      notes: avail.notes,
      isAvailable: avail.isAvailable,
      driver: avail.driverId?.partyId
        ? {
            id: avail.driverId._id.toString(),
            partyId: avail.driverId.partyId?.toString() || null,
          }
        : null,
    }));
  }

  // ==================== NOTIFICATIONS ====================

  /**
   * Send job notification to driver
   * @param {string} jobId - Job ID
   * @param {string} method - Notification method (sms, whatsapp, email)
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async sendJobToDriver(jobId, method, user) {
    const job = await Job.findById(jobId)
      .populate("driverId")
      .populate("customerId")
      .lean();

    if (!job) {
      throw new AppError("Job not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get assignment
    const assignment = await Assignment.findOne({ jobId }).lean();
    if (!assignment) {
      throw new AppError("Assignment not found for this job", HttpStatusCodes.NOT_FOUND);
    }

    // Get driver party for contact info
    const driver = await Driver.findById(job.driverId._id).populate("partyId").lean();
    if (!driver || !driver.partyId) {
      throw new AppError("Driver or driver party not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get customer party for name
    const customer = await Customer.findById(job.customerId._id).populate("partyId").lean();
    const customerName = customer?.partyId?.companyName || 
                        `${customer?.partyId?.firstName || ""} ${customer?.partyId?.lastName || ""}`.trim() ||
                        "Customer";

    // Build notification message
    const message = `Job ${job.jobNumber} - ${job.date}\n` +
                   `Pickup: ${job.pickupSuburb || "TBA"}\n` +
                   `Delivery: ${job.deliverySuburb || "TBA"}\n` +
                   `Customer: ${customerName}\n` +
                   (job.notes ? `Notes: ${job.notes}` : "");

    // Get contact information based on method
    let contactInfo = null;
    if (method === "sms" || method === "whatsapp") {
      contactInfo = driver.partyId.phone || driver.partyId.phoneAlt;
      if (!contactInfo) {
        throw new AppError(
          "Driver phone number not found",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    } else if (method === "email") {
      contactInfo = driver.partyId.email;
      if (!contactInfo) {
        throw new AppError(
          "Driver email not found",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    } else {
      throw new AppError(
        "Invalid notification method. Use 'sms', 'whatsapp', or 'email'",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // TODO: Integrate with actual SMS/WhatsApp/Email service
    // For now, just log the notification
    console.log(`📧 Sending ${method.toUpperCase()} notification to ${contactInfo}:`, message);

    // In production, call the actual notification service:
    // if (method === "sms") {
    //   await sendSMS(contactInfo, message);
    // } else if (method === "whatsapp") {
    //   await sendWhatsApp(contactInfo, message);
    // } else if (method === "email") {
    //   await sendEmail(contactInfo, "Job Assignment", message);
    // }

    return {
      success: true,
      message: "Notification sent successfully",
      to: contactInfo,
    };
  }

  /**
   * Request paperwork SMS for an assignment
   * @param {string} assignmentId - Assignment ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async requestPaperworkSms(assignmentId, user) {
    const assignment = await Assignment.findById(assignmentId)
      .populate("jobId")
      .populate("driverId")
      .lean();

    if (!assignment) {
      throw new AppError("Assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get driver party for phone number
    const driver = await Driver.findById(assignment.driverId._id).populate("partyId").lean();
    if (!driver || !driver.partyId) {
      throw new AppError("Driver or driver party not found", HttpStatusCodes.NOT_FOUND);
    }

    const phoneNumber = driver.partyId.phone || driver.partyId.phoneAlt;
    if (!phoneNumber) {
      throw new AppError(
        "Driver phone number not found",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build SMS message
    const job = assignment.jobId;
    const message = `Please submit paperwork for Job ${job.jobNumber}. Thank you!`;

    // TODO: Integrate with actual SMS service
    // For now, just log and update the assignment
    console.log(`📱 Sending paperwork SMS to ${phoneNumber}:`, message);

    // Update assignment
    await Assignment.findByIdAndUpdate(assignmentId, {
      paperworkSmsRequested: true,
      paperworkSmsSentAt: new Date(),
    });

    return {
      success: true,
      message: "Paperwork SMS requested",
    };
  }
}

module.exports = AllocatorService;

