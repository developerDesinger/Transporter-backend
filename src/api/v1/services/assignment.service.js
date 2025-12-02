const Assignment = require("../models/assignment.model");
const Job = require("../models/job.model");
const Driver = require("../models/driver.model");
const Customer = require("../models/customer.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

class AssignmentService {
  /**
   * Update assignment details
   * @param {string} assignmentId - Assignment ID
   * @param {Object} data - Request data (startTime, finishTime, breakMinutes)
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated assignment object
   */
  static async updateAssignment(assignmentId, data, user) {
    const errors = [];
    const organizationId = user.activeOrganizationId || null;

    // Validate assignmentId format
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      throw new AppError("Invalid assignment ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate assignment exists
    const assignment = await Assignment.findById(assignmentId).lean();

    if (!assignment) {
      throw new AppError("Assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get associated job to check organization and status
    const jobFilter = {
      _id: assignment.jobId,
    };

    // Filter by organization
    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    const job = await Job.findOne(jobFilter).lean();

    if (!job) {
      // Job not found or doesn't belong to organization
      throw new AppError("Assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Verify job is not closed
    if (job.status === "CLOSED") {
      throw new AppError(
        "Cannot update assignment for a closed job",
        HttpStatusCodes.CONFLICT
      );
    }

    // Build update object (only include provided fields)
    const updateData = {};

    // Validate and parse startTime
    if (data.startTime !== undefined) {
      if (data.startTime === null) {
        updateData.startTime = null;
      } else {
        const parsedStartTime = new Date(data.startTime);
        if (isNaN(parsedStartTime.getTime())) {
          errors.push({
            field: "startTime",
            message: "Invalid date format",
          });
        } else {
          updateData.startTime = parsedStartTime;
        }
      }
    }

    // Validate and parse finishTime
    if (data.finishTime !== undefined) {
      if (data.finishTime === null) {
        updateData.finishTime = null;
      } else {
        const parsedFinishTime = new Date(data.finishTime);
        if (isNaN(parsedFinishTime.getTime())) {
          errors.push({
            field: "finishTime",
            message: "Invalid date format",
          });
        } else {
          updateData.finishTime = parsedFinishTime;
        }
      }
    }

    // Validate breakMinutes
    if (data.breakMinutes !== undefined) {
      const breakMins = Number(data.breakMinutes);
      if (isNaN(breakMins) || breakMins < 0) {
        errors.push({
          field: "breakMinutes",
          message: "Break minutes must be a number >= 0",
        });
      } else {
        updateData.breakMinutes = breakMins;
      }
    }

    // Return validation errors if any
    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Validate time logic
    // Get final values (new or existing)
    const finalStartTime =
      updateData.startTime !== undefined
        ? updateData.startTime
        : assignment.startTime
          ? new Date(assignment.startTime)
          : null;

    const finalFinishTime =
      updateData.finishTime !== undefined
        ? updateData.finishTime
        : assignment.finishTime
          ? new Date(assignment.finishTime)
          : null;

    // If both times exist, verify finishTime > startTime
    if (finalStartTime && finalFinishTime && finalFinishTime <= finalStartTime) {
      throw new AppError(
        "Finish time must be after start time",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update assignment (only provided fields)
    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = new Date();

      await Assignment.updateOne(
        { _id: new mongoose.Types.ObjectId(assignmentId) },
        { $set: updateData }
      );
    }

    // Fetch updated assignment
    const updatedAssignment = await Assignment.findById(assignmentId).lean();

    // Format response
    const responseData = {
      id: updatedAssignment._id.toString(),
      jobId: updatedAssignment.jobId.toString(),
      driverId: updatedAssignment.driverId.toString(),
      startTime: updatedAssignment.startTime
        ? updatedAssignment.startTime.toISOString()
        : null,
      finishTime: updatedAssignment.finishTime
        ? updatedAssignment.finishTime.toISOString()
        : null,
      breakMinutes: updatedAssignment.breakMinutes || 0,
      paperworkSmsRequested: updatedAssignment.paperworkSmsRequested || false,
      paperworkSmsRequestedAt: updatedAssignment.paperworkSmsSentAt
        ? updatedAssignment.paperworkSmsSentAt.toISOString()
        : null, // Use paperworkSmsSentAt as paperworkSmsRequestedAt
      createdAt: updatedAssignment.createdAt.toISOString(),
      updatedAt: updatedAssignment.updatedAt.toISOString(),
    };

    return responseData;
  }

  /**
   * Request paperwork SMS for an assignment
   * @param {string} assignmentId - Assignment ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated assignment object
   */
  static async requestPaperworkSms(assignmentId, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate assignmentId format
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      throw new AppError("Invalid assignment ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate assignment exists
    const assignment = await Assignment.findById(assignmentId).lean();

    if (!assignment) {
      throw new AppError("Assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get associated job to check organization and status
    const jobFilter = {
      _id: assignment.jobId,
    };

    // Filter by organization
    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    const job = await Job.findOne(jobFilter)
      .populate({
        path: "customerId",
        model: "Customer",
        select: "partyId",
        populate: {
          path: "partyId",
          model: "Party",
          select: "companyName firstName lastName",
        },
      })
      .lean();

    if (!job) {
      // Job not found or doesn't belong to organization
      throw new AppError("Assignment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if SMS already requested (idempotency)
    if (assignment.paperworkSmsRequested) {
      throw new AppError(
        "Paperwork SMS has already been requested for this assignment",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify job is not closed
    if (job.status === "CLOSED") {
      throw new AppError(
        "Cannot request SMS for a closed job",
        HttpStatusCodes.CONFLICT
      );
    }

    // Get driver with party information
    const driver = await Driver.findById(assignment.driverId)
      .populate({
        path: "partyId",
        model: "Party",
        select: "phone phoneAlt firstName lastName",
      })
      .lean();

    if (!driver || !driver.partyId) {
      throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
    }

    // Validate driver has phone number
    const phoneNumber = driver.partyId.phone || driver.partyId.phoneAlt;
    if (!phoneNumber || phoneNumber.trim() === "") {
      throw new AppError(
        "Driver does not have a phone number",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build SMS message
    const customer = job.customerId;
    const customerName = customer?.partyId?.companyName ||
      (customer?.partyId?.firstName && customer?.partyId?.lastName
        ? `${customer.partyId.firstName} ${customer.partyId.lastName}`.trim()
        : "Customer");

    // Convert serviceDate - Job model uses date (string), format for SMS
    const serviceDate = new Date(job.date + "T00:00:00.000Z");
    const formattedDate = serviceDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    // Build SMS message content
    let smsMessage = `Paperwork Request - Job ${job.jobNumber}\n`;
    smsMessage += `Customer: ${customerName}\n`;
    smsMessage += `Date: ${formattedDate}\n`;

    if (job.pickupSuburb && job.deliverySuburb) {
      smsMessage += `Route: ${job.pickupSuburb} → ${job.deliverySuburb}\n`;
    }

    smsMessage += `Please submit your paperwork for this job.`;

    // Send SMS (handle errors gracefully)
    let smsSent = false;
    try {
      // TODO: Integrate with actual SMS service (Twilio, AWS SNS, etc.)
      // For now, just log the SMS
      console.log(`📱 Sending paperwork SMS to ${phoneNumber}:`, smsMessage);

      // In production, call SMS service:
      // await sendSMS(phoneNumber, smsMessage);

      smsSent = true;
    } catch (smsError) {
      console.error("SMS service error:", smsError);
      // Continue to update assignment even if SMS fails
      // This tracks that the request was made
    }

    // Update assignment (always update, even if SMS failed)
    const now = new Date();
    await Assignment.updateOne(
      { _id: new mongoose.Types.ObjectId(assignmentId) },
      {
        $set: {
          paperworkSmsRequested: true,
          paperworkSmsSentAt: now, // Use paperworkSmsSentAt as paperworkSmsRequestedAt
          updatedAt: now,
        },
      }
    );

    // Fetch updated assignment
    const updatedAssignment = await Assignment.findById(assignmentId).lean();

    // Format response
    const responseData = {
      id: updatedAssignment._id.toString(),
      jobId: updatedAssignment.jobId.toString(),
      driverId: updatedAssignment.driverId.toString(),
      startTime: updatedAssignment.startTime
        ? updatedAssignment.startTime.toISOString()
        : null,
      finishTime: updatedAssignment.finishTime
        ? updatedAssignment.finishTime.toISOString()
        : null,
      breakMinutes: updatedAssignment.breakMinutes || 0,
      paperworkSmsRequested: updatedAssignment.paperworkSmsRequested,
      paperworkSmsRequestedAt: updatedAssignment.paperworkSmsSentAt
        ? updatedAssignment.paperworkSmsSentAt.toISOString()
        : null, // Use paperworkSmsSentAt as paperworkSmsRequestedAt
      createdAt: updatedAssignment.createdAt.toISOString(),
      updatedAt: updatedAssignment.updatedAt.toISOString(),
    };

    // If SMS failed, still return the updated assignment but with error
    if (!smsSent) {
      const error = new AppError(
        "Failed to send SMS",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
      error.data = responseData;
      throw error;
    }

    return responseData;
  }
}

module.exports = AssignmentService;

