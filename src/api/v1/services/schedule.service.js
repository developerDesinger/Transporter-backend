const mongoose = require("mongoose");
const moment = require("moment-timezone");
const Job = require("../models/job.model");
const Assignment = require("../models/assignment.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || "UTC";
const DEFAULT_HOURS_WINDOW = 48;
const MAX_HOURS_WINDOW = 168;
const UPCOMING_LIMIT = 20;
const ALLOWED_JOB_TYPES = ["PUD", "LINEHAUL"];
const UPCOMING_STATUSES = new Set(["SCHEDULED", "ASSIGNED", "IN_TRANSIT"]);

const getFirstValidTimezone = (...candidates) => {
  for (const tz of candidates) {
    if (tz && moment.tz.zone(tz)) {
      return tz;
    }
  }
  return "UTC";
};

const formatName = (party) => {
  if (!party) return null;
  if (party.companyName) return party.companyName;
  const parts = [];
  if (party.firstName) parts.push(party.firstName);
  if (party.lastName) parts.push(party.lastName);
  return parts.join(" ").trim() || null;
};

const normalizeStatus = (job) => {
  if (job?.jobStatus && UPCOMING_STATUSES.has(job.jobStatus.toUpperCase())) {
    return job.jobStatus.toUpperCase();
  }
  if (job?.status === "OPEN") {
    return "SCHEDULED";
  }
  if (job?.status) {
    return job.status.toUpperCase();
  }
  return "SCHEDULED";
};

const combineDateTime = (dateStr, timeStr, timezone) => {
  if (!dateStr) {
    return null;
  }
  const time = timeStr || "08:00";
  const m = moment.tz(`${dateStr} ${time}`, "YYYY-MM-DD HH:mm", timezone);
  if (!m.isValid()) return null;
  return m;
};

class ScheduleService {
  static async getUpcomingSchedule(query, user) {
    const organizationId = user.activeOrganizationId || null;
    const requestedHours = query.hours ? parseInt(query.hours, 10) : null;

    if (
      requestedHours !== null &&
      (Number.isNaN(requestedHours) || requestedHours <= 0)
    ) {
      throw new AppError("Invalid hours value", HttpStatusCodes.BAD_REQUEST);
    }

    const hours =
      requestedHours !== null ? Math.min(requestedHours, MAX_HOURS_WINDOW) : DEFAULT_HOURS_WINDOW;

    const timezone = getFirstValidTimezone(
      query.timezone,
      user?.timezone,
      user?.preferences?.timezone,
      user?.profile?.timezone,
      DEFAULT_TIMEZONE
    );

    const jobTypeFilter = query.type
      ? query.type.toString().toUpperCase()
      : null;
    if (jobTypeFilter && !ALLOWED_JOB_TYPES.includes(jobTypeFilter)) {
      throw new AppError("Invalid schedule type", HttpStatusCodes.BAD_REQUEST);
    }

    const windowStartTz = moment.tz(timezone);
    const windowEndTz = windowStartTz.clone().add(hours, "hours");

    const jobFilter = {
      status: { $ne: "CLOSED" },
      date: {
        $gte: windowStartTz.clone().subtract(1, "day").format("YYYY-MM-DD"),
        $lte: windowEndTz.clone().add(1, "day").format("YYYY-MM-DD"),
      },
    };

    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    if (jobTypeFilter) {
      jobFilter.boardType = jobTypeFilter;
    }

    const jobs = await Job.find(jobFilter)
      .select(
        "jobNumber boardType customerId pickupSuburb deliverySuburb vehicleType jobStatus status date startTime pickupTime deliveryTime"
      )
      .populate({
        path: "customerId",
        select: "partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .lean();

    if (jobs.length === 0) {
      return [];
    }

    const jobIds = jobs.map((job) => job._id);
    const assignments = await Assignment.find({ jobId: { $in: jobIds } })
      .populate({
        path: "driverId",
        select: "driverCode partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .lean();

    const assignmentByJob = new Map();
    assignments.forEach((assignment) => {
      const jobId = assignment.jobId?.toString();
      if (!jobId) return;
      // Keep earliest assignment start time if multiple
      const existing = assignmentByJob.get(jobId);
      if (!existing) {
        assignmentByJob.set(jobId, assignment);
        return;
      }
      if (
        assignment.startTime &&
        (!existing.startTime ||
          new Date(assignment.startTime) < new Date(existing.startTime))
      ) {
        assignmentByJob.set(jobId, assignment);
      }
    });

    const upcomingItems = [];

    jobs.forEach((job) => {
      const jobIdStr = job._id.toString();
      const assignment = assignmentByJob.get(jobIdStr);

      const driver = assignment?.driverId;
      const driverParty = driver?.partyId;

      const status = normalizeStatus(job);
      if (!UPCOMING_STATUSES.has(status)) {
        return;
      }

      let etaMoment = null;
      if (assignment?.startTime) {
        etaMoment = moment(assignment.startTime).tz(timezone);
      }

      if (!etaMoment) {
        etaMoment =
          combineDateTime(job.date, job.startTime || job.pickupTime, timezone) ||
          combineDateTime(job.date, job.deliveryTime, timezone);
      }

      if (!etaMoment || !etaMoment.isValid()) {
        return;
      }

      if (etaMoment.isBefore(windowStartTz) || etaMoment.isAfter(windowEndTz)) {
        return;
      }

      const customerParty = job.customerId?.partyId;

      upcomingItems.push({
        id: jobIdStr,
        jobNumber: job.jobNumber || `JOB-${jobIdStr.slice(-6)}`,
        jobType: job.boardType || "PUD",
        customerName: formatName(customerParty) || "Unknown Customer",
        pickupSuburb: job.pickupSuburb || null,
        deliverySuburb: job.deliverySuburb || null,
        vehicleType: job.vehicleType || null,
        driverName: formatName(driverParty),
        driverCode: driver?.driverCode || null,
        eta: etaMoment.toISOString(),
        status,
      });
    });

    upcomingItems.sort(
      (a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime()
    );

    return upcomingItems.slice(0, UPCOMING_LIMIT);
  }
}

module.exports = ScheduleService;


