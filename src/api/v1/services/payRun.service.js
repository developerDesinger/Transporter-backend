const PayRun = require("../models/payRun.model");
const PayRunDriver = require("../models/payRunDriver.model");
const PayRunItem = require("../models/payRunItem.model");
const Driver = require("../models/driver.model");
const Job = require("../models/job.model");
const DriverAdjustment = require("../models/driverAdjustment.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

class PayRunService {
  /**
   * Build a new pay run by collecting eligible jobs and adjustments
   * @param {Object} data - Request data (cohortDays, periodStart, periodEnd, label, driverIds)
   * @param {Object} user - Authenticated user
   * @returns {Object} Created pay run with driver summaries
   */
  static async buildPayRun(data, user) {
    const errors = [];

    // 1. Validate Input
    if (!data.cohortDays || ![7, 14, 21, 30].includes(data.cohortDays)) {
      errors.push({
        field: "cohortDays",
        message: "cohortDays must be 7, 14, 21, or 30",
      });
    }

    if (!data.periodStart || !/^\d{4}-\d{2}-\d{2}$/.test(data.periodStart)) {
      errors.push({
        field: "periodStart",
        message: "periodStart is required and must be in YYYY-MM-DD format",
      });
    }

    if (!data.periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(data.periodEnd)) {
      errors.push({
        field: "periodEnd",
        message: "periodEnd is required and must be in YYYY-MM-DD format",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Parse dates
    const startDate = new Date(data.periodStart + "T00:00:00");
    const endDate = new Date(data.periodEnd + "T23:59:59");

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new AppError("Invalid date format", HttpStatusCodes.BAD_REQUEST);
    }

    if (startDate > endDate) {
      throw new AppError(
        "periodStart must be before or equal to periodEnd",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate driverIds if provided
    if (data.driverIds && Array.isArray(data.driverIds)) {
      for (const driverId of data.driverIds) {
        if (!mongoose.Types.ObjectId.isValid(driverId)) {
          errors.push({
            field: "driverIds",
            message: `Invalid driver ID: ${driverId}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    const organizationId = user.activeOrganizationId || null;
    const createdBy = user.id || user._id;

    // 2. Identify Eligible Drivers
    let eligibleDrivers;
    if (data.driverIds && Array.isArray(data.driverIds) && data.driverIds.length > 0) {
      // Fetch specific drivers
      const driverObjectIds = data.driverIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      eligibleDrivers = await Driver.find({
        _id: { $in: driverObjectIds },
        isActive: true,
      }).lean();
    } else {
      // Fetch all drivers in cohort
      // Note: Driver model doesn't have organizationId directly
      eligibleDrivers = await Driver.find({
        payTermsDays: data.cohortDays,
        isActive: true,
      }).lean();
    }

    if (eligibleDrivers.length === 0) {
      throw new AppError(
        "No eligible drivers found for the specified cohort",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const driverIdsList = eligibleDrivers.map((d) => d._id.toString());

    // 3. Generate label if not provided
    const payRunLabel =
      data.label || `${data.cohortDays} Day Cohort – ${data.periodStart} → ${data.periodEnd}`;

    // 4. Generate pay run number
    const payRunNumber = await this.generatePayRunNumber(organizationId);

    // 5. Create pay run
    const payRun = await PayRun.create({
      payRunNumber: payRunNumber,
      label: payRunLabel,
      cohortDays: data.cohortDays,
      periodStart: startDate,
      periodEnd: endDate,
      status: "DRAFT",
      createdBy: new mongoose.Types.ObjectId(createdBy),
      organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
    });

    const payRunId = payRun._id.toString();
    const driverSummaries = [];

    // 6. Process each driver
    for (const driver of eligibleDrivers) {
      const driverId = driver._id.toString();
      let gross = 0;
      let adjustments = 0;
      let itemCount = 0;

      // 7. Find eligible jobs
      // Use date field (YYYY-MM-DD string) for filtering, and check completedAt if available
      const dateFilter = {
        $gte: data.periodStart,
        $lte: data.periodEnd,
      };

      const eligibleJobs = await Job.find({
        driverId: new mongoose.Types.ObjectId(driverId),
        driverPayStatus: "UNPOSTED",
        date: dateFilter,
        $or: [
          { driverPayDeferralUntil: null },
          { driverPayDeferralUntil: { $lte: endDate } },
        ],
        organizationId: organizationId,
      }).lean();

      // Create pay run items for jobs
      for (const job of eligibleJobs) {
        const amount = parseFloat(job.driverPay || 0);
        if (amount > 0) {
          gross += amount;
          itemCount++;

          await PayRunItem.create({
            payrunId: payRunId,
            driverId: driverId,
            kind: "JOB",
            jobId: job._id.toString(),
            description: job.jobNumber || `Job ${job._id}`,
            amount: amount,
            excluded: false,
          });
        }
      }

      // 8. Find eligible adjustments
      const eligibleAdjustments = await DriverAdjustment.find({
        driverId: new mongoose.Types.ObjectId(driverId),
        status: "APPROVED",
        effectiveDate: { $gte: startDate, $lte: endDate },
        organizationId: organizationId,
      }).lean();

      // Filter out already posted adjustments
      const postedAdjustmentIds = await PayRunItem.distinct("driverAdjustmentId", {
        kind: "ADJUSTMENT",
        driverAdjustmentId: {
          $in: eligibleAdjustments.map((a) => new mongoose.Types.ObjectId(a._id)),
        },
      });

      const unpostedAdjustments = eligibleAdjustments.filter(
        (adj) => !postedAdjustmentIds.some((id) => id.toString() === adj._id.toString())
      );

      // Create pay run items for adjustments
      for (const adjustment of unpostedAdjustments) {
        const amount = parseFloat(adjustment.amount || 0);
        adjustments += amount;
        itemCount++;

        await PayRunItem.create({
          payrunId: payRunId,
          driverId: driverId,
          kind: "ADJUSTMENT",
          driverAdjustmentId: adjustment._id.toString(),
          description: adjustment.description || "Adjustment",
          amount: amount,
          excluded: false,
        });
      }

      // 9. Calculate net pay
      const netPay = gross + adjustments;

      // 10. Create driver summary
      await PayRunDriver.create({
        payrunId: payRunId,
        driverId: driverId,
        gross: gross,
        adjustments: adjustments,
        netPay: netPay,
        totalAmount: netPay, // Backward compatibility
      });

      driverSummaries.push({
        driverId: driverId,
        gross: gross,
        adjustments: adjustments,
        netPay: netPay,
        itemCount: itemCount,
      });
    }

    // 11. Calculate totals
    const summary = {
      totalDrivers: driverSummaries.length,
      totalItems: driverSummaries.reduce((sum, d) => sum + d.itemCount, 0),
      totalGross: driverSummaries.reduce((sum, d) => sum + d.gross, 0),
      totalAdjustments: driverSummaries.reduce((sum, d) => sum + d.adjustments, 0),
      totalNetPay: driverSummaries.reduce((sum, d) => sum + d.netPay, 0),
    };

    return {
      success: true,
      data: {
        id: payRunId,
        label: payRunLabel,
        cohortDays: data.cohortDays,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: "DRAFT",
        createdBy: createdBy.toString(),
        createdAt: payRun.createdAt.toISOString(),
        drivers: driverSummaries,
        summary: summary,
      },
    };
  }

  /**
   * Generate unique pay run number
   * @param {string} organizationId - Organization ID
   * @returns {string} Generated pay run number
   */
  static async generatePayRunNumber(organizationId) {
    const year = new Date().getFullYear();
    const pattern = new RegExp(`^PR-${year}-`);

    const lastPayRun = await PayRun.findOne({
      organizationId: organizationId,
      payRunNumber: pattern,
    }).sort({ payRunNumber: -1 });

    let sequence = 1;
    if (lastPayRun) {
      const parts = lastPayRun.payRunNumber.split("-");
      const lastSequence = parseInt(parts[2]);
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    return `PR-${year}-${String(sequence).padStart(3, "0")}`;
  }

  /**
   * Get all pay runs with optional filtering, sorting, and pagination
   * @param {Object} query - Query parameters (cohortDays, status, from, to, page, limit, sortBy, sortOrder)
   * @param {Object} user - Authenticated user
   * @returns {Object} Paginated pay runs with optional summaries
   */
  static async getAllPayRuns(query, user) {
    const PayRunDriver = require("../models/payRunDriver.model");
    const errors = [];

    // Validation
    if (query.cohortDays) {
      const cohortValue = parseInt(query.cohortDays);
      if (![7, 14, 21, 30].includes(cohortValue)) {
        errors.push({
          field: "cohortDays",
          message: "cohortDays must be 7, 14, 21, or 30",
        });
      }
    }

    if (query.status && !["DRAFT", "POSTED", "VOID"].includes(query.status)) {
      errors.push({
        field: "status",
        message: "status must be DRAFT, POSTED, or VOID",
      });
    }

    if (query.from && !/^\d{4}-\d{2}-\d{2}$/.test(query.from)) {
      errors.push({
        field: "from",
        message: "from must be in YYYY-MM-DD format",
      });
    }

    if (query.to && !/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
      errors.push({
        field: "to",
        message: "to must be in YYYY-MM-DD format",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    const organizationId = user.activeOrganizationId || null;

    // Build query
    const filter = {};

    // Multi-tenancy
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Filter by cohortDays
    if (query.cohortDays) {
      filter.cohortDays = parseInt(query.cohortDays);
    }

    // Filter by status
    if (query.status) {
      filter.status = query.status;
    }

    // Filter by date range
    if (query.from || query.to) {
      filter.$and = [];
      if (query.from) {
        filter.$and.push({
          periodStart: { $gte: new Date(query.from + "T00:00:00") },
        });
      }
      if (query.to) {
        filter.$and.push({
          periodEnd: { $lte: new Date(query.to + "T23:59:59") },
        });
      }
    }

    // Pagination
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Sorting
    const validSortFields = ["createdAt", "periodStart", "periodEnd", "cohortDays", "status"];
    const sortBy = validSortFields.includes(query.sortBy) ? query.sortBy : "createdAt";
    const sortOrder = query.sortOrder === "asc" ? 1 : -1;
    const sort = { [sortBy]: sortOrder };

    // Fetch pay runs
    const [payRuns, total] = await Promise.all([
      PayRun.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      PayRun.countDocuments(filter),
    ]);

    // Optionally populate summary statistics
    const payRunsWithSummary = await Promise.all(
      payRuns.map(async (payRun) => {
        const summary = await PayRunDriver.aggregate([
          {
            $match: { payrunId: new mongoose.Types.ObjectId(payRun._id) },
          },
          {
            $group: {
              _id: null,
              totalDrivers: { $sum: 1 },
              totalNetPay: { $sum: "$netPay" },
            },
          },
        ]);

        return {
          id: payRun._id.toString(),
          label: payRun.label || null,
          cohortDays: payRun.cohortDays,
          periodStart: payRun.periodStart.toISOString(),
          periodEnd: payRun.periodEnd.toISOString(),
          status: payRun.status,
          createdBy: payRun.createdBy
            ? payRun.createdBy.toString()
            : null,
          postedBy: payRun.postedBy ? payRun.postedBy.toString() : null,
          createdAt: payRun.createdAt.toISOString(),
          postedAt: payRun.postedAt ? payRun.postedAt.toISOString() : null,
          summary:
            summary.length > 0
              ? {
                  totalDrivers: summary[0].totalDrivers || 0,
                  totalNetPay: summary[0].totalNetPay || 0,
                }
              : {
                  totalDrivers: 0,
                  totalNetPay: 0,
                },
        };
      })
    );

    return {
      success: true,
      data: payRunsWithSummary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get pay run detail by ID
   * @param {string} payRunId - Pay run ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Pay run object with summary statistics
   */
  static async getPayRunById(payRunId, user) {
    const PayRunDriver = require("../models/payRunDriver.model");

    // Validate ID
    if (!payRunId) {
      throw new AppError("Pay run ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(payRunId)) {
      throw new AppError("Invalid pay run ID format", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = user.activeOrganizationId || null;

    // Build query
    const filter = {
      _id: new mongoose.Types.ObjectId(payRunId),
    };

    // Multi-tenancy
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Fetch pay run
    const payRun = await PayRun.findOne(filter).lean();

    if (!payRun) {
      throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
    }

    // Calculate summary statistics
    const summary = await PayRunDriver.aggregate([
      {
        $match: { payrunId: new mongoose.Types.ObjectId(payRunId) },
      },
      {
        $group: {
          _id: null,
          totalDrivers: { $sum: 1 },
          totalNetPay: { $sum: "$netPay" },
        },
      },
    ]);

    const summaryData =
      summary.length > 0
        ? {
            totalDrivers: summary[0].totalDrivers || 0,
            totalNetPay: summary[0].totalNetPay || 0,
          }
        : {
            totalDrivers: 0,
            totalNetPay: 0,
          };

    // Transform response
    return {
      success: true,
      data: {
        id: payRun._id.toString(),
        label: payRun.label || null,
        cohortDays: payRun.cohortDays,
        periodStart: payRun.periodStart.toISOString(),
        periodEnd: payRun.periodEnd.toISOString(),
        status: payRun.status,
        createdBy: payRun.createdBy
          ? payRun.createdBy.toString()
          : null,
        postedBy: payRun.postedBy ? payRun.postedBy.toString() : null,
        createdAt: payRun.createdAt.toISOString(),
        postedAt: payRun.postedAt ? payRun.postedAt.toISOString() : null,
        summary: summaryData,
      },
    };
  }

  /**
   * Get all drivers in a pay run with their payment summaries
   * @param {string} payRunId - Pay run ID
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of driver summaries with names
   */
  static async getPayRunDrivers(payRunId, user) {
    const PayRunDriver = require("../models/payRunDriver.model");
    const Driver = require("../models/driver.model");
    const Party = require("../models/party.model");

    // Validate ID
    if (!payRunId) {
      throw new AppError("Pay run ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(payRunId)) {
      throw new AppError("Invalid pay run ID format", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = user.activeOrganizationId || null;

    // Verify pay run exists and belongs to organization
    const filter = {
      _id: new mongoose.Types.ObjectId(payRunId),
    };

    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    const payRun = await PayRun.findOne(filter).lean();

    if (!payRun) {
      throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
    }

    // Fetch driver summaries with populated driver and party
    const driverSummaries = await PayRunDriver.find({
      payrunId: new mongoose.Types.ObjectId(payRunId),
    })
      .populate({
        path: "driverId",
        model: Driver,
        populate: {
          path: "partyId",
          model: Party,
          select: "companyName firstName lastName",
        },
      })
      .lean();

    // Transform response with driver names
    const drivers = driverSummaries.map((summary) => {
      const driver = summary.driverId;
      const party = driver?.partyId;

      // Resolve driver name
      let driverName = "Unknown driver";
      if (party) {
        if (party.companyName) {
          driverName = party.companyName;
        } else if (party.firstName || party.lastName) {
          driverName = `${party.firstName || ""} ${party.lastName || ""}`.trim();
        }
      }

      return {
        id: summary._id.toString(),
        payrunId: summary.payrunId.toString(),
        driverId: driver ? driver._id.toString() : summary.driverId.toString(),
        driverName: driverName,
        gross: parseFloat(summary.gross || 0),
        adjustments: parseFloat(summary.adjustments || 0),
        netPay: parseFloat(summary.netPay || 0),
      };
    });

    // Sort by driver name
    drivers.sort((a, b) => a.driverName.localeCompare(b.driverName));

    return drivers;
  }

  /**
   * Get all items (jobs and adjustments) in a pay run
   * @param {string} payRunId - Pay run ID
   * @param {Object} query - Query parameters (driverId)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of pay run items with dates
   */
  static async getPayRunItems(payRunId, query, user) {
    const PayRunItem = require("../models/payRunItem.model");
    const Job = require("../models/job.model");
    const DriverAdjustment = require("../models/driverAdjustment.model");

    // Validate ID
    if (!payRunId) {
      throw new AppError("Pay run ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(payRunId)) {
      throw new AppError("Invalid pay run ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate driverId if provided
    if (query.driverId && !mongoose.Types.ObjectId.isValid(query.driverId)) {
      throw new AppError("Invalid driver ID format", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = user.activeOrganizationId || null;

    // Verify pay run exists and belongs to organization
    const filter = {
      _id: new mongoose.Types.ObjectId(payRunId),
    };

    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    const payRun = await PayRun.findOne(filter).lean();

    if (!payRun) {
      throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
    }

    // Build query for items
    const itemFilter = {
      payrunId: new mongoose.Types.ObjectId(payRunId),
    };

    // Filter by driverId if provided
    if (query.driverId) {
      itemFilter.driverId = new mongoose.Types.ObjectId(query.driverId);
    }

    // Fetch pay run items with populated job and adjustment
    const items = await PayRunItem.find(itemFilter)
      .populate({
        path: "jobId",
        model: Job,
        select: "completedAt date jobNumber",
      })
      .populate({
        path: "driverAdjustmentId",
        model: DriverAdjustment,
        select: "effectiveDate description",
      })
      .sort({ driverId: 1, createdAt: 1 })
      .lean();

    // Transform response with dates
    const transformedItems = items.map((item) => {
      let itemDate = item.createdAt;

      // Get date from job or adjustment
      if (item.kind === "JOB" && item.jobId) {
        // Use completedAt if available, otherwise use job date, fallback to createdAt
        if (item.jobId.completedAt) {
          itemDate = item.jobId.completedAt;
        } else if (item.jobId.date) {
          // Convert YYYY-MM-DD string to Date
          itemDate = new Date(item.jobId.date + "T00:00:00");
        } else {
          itemDate = item.createdAt;
        }
      } else if (item.kind === "ADJUSTMENT" && item.driverAdjustmentId) {
        itemDate = item.driverAdjustmentId.effectiveDate || item.createdAt;
      }

      return {
        id: item._id.toString(),
        payrunId: item.payrunId.toString(),
        driverId: item.driverId.toString(),
        kind: item.kind,
        jobId: item.jobId ? item.jobId._id.toString() : null,
        driverAdjustmentId: item.driverAdjustmentId
          ? item.driverAdjustmentId._id.toString()
          : null,
        description: item.description,
        amount: parseFloat(item.amount || 0),
        excluded: item.excluded || false,
        excludeReason: item.excludeReason || null,
        date: itemDate ? new Date(itemDate).toISOString() : item.createdAt.toISOString(),
      };
    });

    return transformedItems;
  }

  /**
   * Post a pay run (finalize it)
   * @param {string} payRunId - Pay run ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated pay run with POSTED status
   */
  static async postPayRun(payRunId, user) {
    const PayRunItem = require("../models/payRunItem.model");
    const Job = require("../models/job.model");
    const DriverAdjustment = require("../models/driverAdjustment.model");
    const mongoose = require("mongoose");

    // Validate ID
    if (!payRunId) {
      throw new AppError("Pay run ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(payRunId)) {
      throw new AppError("Invalid pay run ID format", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = user.activeOrganizationId || null;
    const userId = user.id || user._id;

    // Start transaction
    const session = await mongoose.startSession();
    let transactionStarted = false;

    try {
      session.startTransaction();
      transactionStarted = true;

      // Verify pay run exists and belongs to organization
      const filter = {
        _id: new mongoose.Types.ObjectId(payRunId),
      };

      if (organizationId) {
        filter.organizationId = new mongoose.Types.ObjectId(organizationId);
      } else {
        filter.organizationId = null;
      }

      const payRun = await PayRun.findOne(filter).session(session);

      if (!payRun) {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
      }

      // Validate pay run status
      if (payRun.status === "POSTED") {
        await session.abortTransaction();
        await session.endSession();
        const error = new AppError("Pay run cannot be posted", HttpStatusCodes.BAD_REQUEST);
        error.errors = [
          {
            field: "status",
            message: "Pay run is already posted",
          },
        ];
        throw error;
      }

      if (payRun.status === "VOID") {
        await session.abortTransaction();
        await session.endSession();
        const error = new AppError("Pay run cannot be posted", HttpStatusCodes.BAD_REQUEST);
        error.errors = [
          {
            field: "status",
            message: "Cannot post a voided pay run",
          },
        ];
        throw error;
      }

      // Validate pay run has non-excluded items
      const nonExcludedItemsCount = await PayRunItem.countDocuments({
        payrunId: new mongoose.Types.ObjectId(payRunId),
        excluded: false,
      }).session(session);

      if (nonExcludedItemsCount === 0) {
        await session.abortTransaction();
        await session.endSession();
        const error = new AppError("Pay run cannot be posted", HttpStatusCodes.BAD_REQUEST);
        error.errors = [
          {
            field: "items",
            message: "Pay run must have at least one non-excluded item",
          },
        ];
        throw error;
      }

      const postedAt = new Date();

      // Update jobs (non-excluded JOB items)
      const jobItems = await PayRunItem.find({
        payrunId: new mongoose.Types.ObjectId(payRunId),
        kind: "JOB",
        excluded: false,
      })
        .select("jobId")
        .session(session)
        .lean();

      const jobIds = jobItems
        .map((item) => item.jobId)
        .filter((id) => id !== null && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (jobIds.length > 0) {
        await Job.updateMany(
          { _id: { $in: jobIds } },
          {
            $set: {
              driverPayStatus: "POSTED",
              driverPayrunId: new mongoose.Types.ObjectId(payRunId),
              driverPayPostedAt: postedAt,
            },
          }
        ).session(session);
      }

      // Update adjustments (non-excluded ADJUSTMENT items)
      const adjustmentItems = await PayRunItem.find({
        payrunId: new mongoose.Types.ObjectId(payRunId),
        kind: "ADJUSTMENT",
        excluded: false,
      })
        .select("driverAdjustmentId")
        .session(session)
        .lean();

      const adjustmentIds = adjustmentItems
        .map((item) => item.driverAdjustmentId)
        .filter((id) => id !== null && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (adjustmentIds.length > 0) {
        await DriverAdjustment.updateMany(
          { _id: { $in: adjustmentIds } },
          {
            $set: {
              status: "POSTED",
              postedAt: postedAt,
            },
          }
        ).session(session);
      }

      // Update pay run
      payRun.status = "POSTED";
      payRun.postedAt = postedAt;
      payRun.postedBy = new mongoose.Types.ObjectId(userId);
      await payRun.save({ session });

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      return {
        success: true,
        data: {
          id: payRun._id.toString(),
          status: payRun.status,
          postedAt: payRun.postedAt.toISOString(),
          message: "Pay run posted successfully",
        },
      };
    } catch (error) {
      // Only abort if transaction was started
      if (transactionStarted) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          // Ignore if already aborted
          console.warn("Transaction already aborted:", abortError.message);
        }
      }
      try {
        await session.endSession();
      } catch (endError) {
        // Ignore if session already ended
        console.warn("Session already ended:", endError.message);
      }
      throw error;
    }
  }

  /**
   * Rebuild a pay run (re-query eligibility, preserve exclusions)
   * @param {string} payRunId - Pay run ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated pay run with summary
   */
  static async rebuildPayRun(payRunId, user) {
    const PayRunItem = require("../models/payRunItem.model");
    const PayRunDriver = require("../models/payRunDriver.model");
    const Driver = require("../models/driver.model");
    const Job = require("../models/job.model");
    const DriverAdjustment = require("../models/driverAdjustment.model");
    const mongoose = require("mongoose");

    // Validate ID
    if (!payRunId) {
      throw new AppError("Pay run ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(payRunId)) {
      throw new AppError("Invalid pay run ID format", HttpStatusCodes.BAD_REQUEST);
    }

    const organizationId = user.activeOrganizationId || null;

    // Start transaction
    const session = await mongoose.startSession();
    let transactionStarted = false;

    try {
      session.startTransaction();
      transactionStarted = true;

      // Verify pay run exists and belongs to organization
      const filter = {
        _id: new mongoose.Types.ObjectId(payRunId),
      };

      if (organizationId) {
        filter.organizationId = new mongoose.Types.ObjectId(organizationId);
      } else {
        filter.organizationId = null;
      }

      const payRun = await PayRun.findOne(filter).session(session);

      if (!payRun) {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
      }

      // Validate pay run status
      if (payRun.status !== "DRAFT") {
        await session.abortTransaction();
        await session.endSession();
        const error = new AppError("Pay run cannot be rebuilt", HttpStatusCodes.BAD_REQUEST);
        error.errors = [
          {
            field: "status",
            message: "Only DRAFT pay runs can be rebuilt",
          },
        ];
        throw error;
      }

      // Get existing items with manual exclusions
      const existingItems = await PayRunItem.find({
        payrunId: new mongoose.Types.ObjectId(payRunId),
      })
        .session(session)
        .lean();

      // Map of manually excluded items: { jobId/adjustmentId -> excludeReason }
      const manualExclusions = new Map();
      existingItems.forEach((item) => {
        if (item.excluded && item.excludeReason) {
          const key =
            item.kind === "JOB" ? item.jobId?.toString() : item.driverAdjustmentId?.toString();
          if (key) {
            manualExclusions.set(key, item.excludeReason);
          }
        }
      });

      // Get pay run parameters
      const { cohortDays, periodStart, periodEnd } = payRun;
      const startDate = new Date(periodStart);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(periodEnd);
      endDate.setHours(23, 59, 59, 999);

      // Re-query eligible drivers
      const driverFilter = {
        payTermsDays: cohortDays,
        isActive: true,
      };

      if (organizationId) {
        driverFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
      } else {
        driverFilter.organizationId = null;
      }

      const eligibleDrivers = await Driver.find(driverFilter)
        .select("_id")
        .session(session)
        .lean();

      const driverIds = eligibleDrivers.map((d) => d._id);

      if (driverIds.length === 0) {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError(
          "No eligible drivers found for this cohort",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Re-query eligible jobs
      // Jobs are eligible if:
      // - driverPayStatus = 'UNPOSTED'
      // - date (or completedAt) is within period
      // - driverPayDeferralUntil is NULL or <= periodEnd
      // - not already in another POSTED pay run
      const eligibleJobsRaw = await Job.find({
        driverId: { $in: driverIds },
        driverPayStatus: "UNPOSTED",
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
        $or: [
          { driverPayDeferralUntil: null },
          { driverPayDeferralUntil: { $lte: endDate } },
        ],
      })
        .session(session)
        .lean();

      // Filter by date (completedAt or date field)
      const eligibleJobs = eligibleJobsRaw.filter((job) => {
        // Check completedAt first
        if (job.completedAt) {
          const completedDate = new Date(job.completedAt);
          return completedDate >= startDate && completedDate <= endDate;
        }
        // Otherwise check date field (YYYY-MM-DD string)
        if (job.date) {
          const jobDate = new Date(job.date + "T00:00:00");
          return jobDate >= startDate && jobDate <= endDate;
        }
        return false;
      });

      // Filter out jobs that are already in POSTED pay runs
      const postedPayRunIds = await PayRun.distinct("_id", {
        status: "POSTED",
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
      }).session(session);

      const finalEligibleJobs = eligibleJobs.filter((job) => {
        // If job has a payrunId, check if that pay run is POSTED
        if (job.driverPayrunId) {
          const payRunIdStr = job.driverPayrunId.toString();
          return !postedPayRunIds.some((id) => id.toString() === payRunIdStr);
        }
        return true;
      });

      // Re-query eligible adjustments
      const eligibleAdjustmentsRaw = await DriverAdjustment.find({
        driverId: { $in: driverIds },
        status: "APPROVED",
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
        effectiveDate: { $gte: startDate, $lte: endDate },
        // Not posted (postedAt is null)
        postedAt: null,
      })
        .session(session)
        .lean();

      // Filter out adjustments that are already in POSTED pay runs
      const postedAdjustmentIds = await PayRunItem.distinct("driverAdjustmentId", {
        payrunId: { $in: postedPayRunIds },
        kind: "ADJUSTMENT",
        driverAdjustmentId: { $ne: null },
      }).session(session);

      const eligibleAdjustments = eligibleAdjustmentsRaw.filter((adj) => {
        // Check if adjustment is in any POSTED pay run
        return !postedAdjustmentIds.some((id) => id && id.toString() === adj._id.toString());
      });

      // Create maps of eligible items
      const eligibleJobMap = new Map();
      finalEligibleJobs.forEach((job) => {
        eligibleJobMap.set(job._id.toString(), job);
      });

      const eligibleAdjustmentMap = new Map();
      eligibleAdjustments.forEach((adj) => {
        eligibleAdjustmentMap.set(adj._id.toString(), adj);
      });

      // Track changes
      let itemsAdded = 0;
      let itemsRemoved = 0;
      let itemsUpdated = 0;

      // Process existing items
      const existingItemKeys = new Set();
      for (const existingItem of existingItems) {
        const key =
          existingItem.kind === "JOB"
            ? existingItem.jobId?.toString()
            : existingItem.driverAdjustmentId?.toString();

        if (!key) continue;

        existingItemKeys.add(key);

        if (existingItem.kind === "JOB") {
          const job = eligibleJobMap.get(key);
          if (job) {
            // Item is still eligible
            const wasManuallyExcluded = manualExclusions.has(key);
            const newAmount = parseFloat(job.driverPay || 0);

            // Check if amount changed
            if (Math.abs(parseFloat(existingItem.amount || 0) - newAmount) > 0.01) {
              // Amount changed, update it
              await PayRunItem.updateOne(
                { _id: existingItem._id },
                {
                  $set: {
                    amount: newAmount,
                    excluded: wasManuallyExcluded ? true : existingItem.excluded,
                    excludeReason: wasManuallyExcluded
                      ? manualExclusions.get(key)
                      : existingItem.excludeReason,
                  },
                }
              ).session(session);
              itemsUpdated++;
            } else if (wasManuallyExcluded && !existingItem.excluded) {
              // Was manually excluded but not marked as excluded, restore exclusion
              await PayRunItem.updateOne(
                { _id: existingItem._id },
                {
                  $set: {
                    excluded: true,
                    excludeReason: manualExclusions.get(key),
                  },
                }
              ).session(session);
            } else if (wasManuallyExcluded && existingItem.excluded) {
              // Already excluded, ensure excludeReason is preserved
              if (existingItem.excludeReason !== manualExclusions.get(key)) {
                await PayRunItem.updateOne(
                  { _id: existingItem._id },
                  {
                    $set: {
                      excludeReason: manualExclusions.get(key),
                    },
                  }
                ).session(session);
              }
            }
          } else {
            // Item is no longer eligible, remove it
            await PayRunItem.deleteOne({ _id: existingItem._id }).session(session);
            itemsRemoved++;
          }
        } else {
          // ADJUSTMENT
          const adjustment = eligibleAdjustmentMap.get(key);
          if (adjustment) {
            // Item is still eligible
            const wasManuallyExcluded = manualExclusions.has(key);
            const newAmount = parseFloat(adjustment.amount || 0);

            // Check if amount changed
            if (Math.abs(parseFloat(existingItem.amount || 0) - newAmount) > 0.01) {
              // Amount changed, update it
              await PayRunItem.updateOne(
                { _id: existingItem._id },
                {
                  $set: {
                    amount: newAmount,
                    excluded: wasManuallyExcluded ? true : existingItem.excluded,
                    excludeReason: wasManuallyExcluded
                      ? manualExclusions.get(key)
                      : existingItem.excludeReason,
                  },
                }
              ).session(session);
              itemsUpdated++;
            } else if (wasManuallyExcluded && !existingItem.excluded) {
              // Was manually excluded but not marked as excluded, restore exclusion
              await PayRunItem.updateOne(
                { _id: existingItem._id },
                {
                  $set: {
                    excluded: true,
                    excludeReason: manualExclusions.get(key),
                  },
                }
              ).session(session);
            } else if (wasManuallyExcluded && existingItem.excluded) {
              // Already excluded, ensure excludeReason is preserved
              if (existingItem.excludeReason !== manualExclusions.get(key)) {
                await PayRunItem.updateOne(
                  { _id: existingItem._id },
                  {
                    $set: {
                      excludeReason: manualExclusions.get(key),
                    },
                  }
                ).session(session);
              }
            }
          } else {
            // Item is no longer eligible, remove it
            await PayRunItem.deleteOne({ _id: existingItem._id }).session(session);
            itemsRemoved++;
          }
        }
      }

      // Add new eligible items
      for (const job of finalEligibleJobs) {
        const key = job._id.toString();
        if (!existingItemKeys.has(key)) {
          // New eligible job, add it
          const wasManuallyExcluded = manualExclusions.has(key);
          await PayRunItem.create(
            [
              {
                payrunId: new mongoose.Types.ObjectId(payRunId),
                driverId: new mongoose.Types.ObjectId(job.driverId),
                kind: "JOB",
                jobId: new mongoose.Types.ObjectId(job._id),
                driverAdjustmentId: null,
                description: job.jobNumber || `Job ${job._id}`,
                amount: parseFloat(job.driverPay || 0),
                excluded: wasManuallyExcluded,
                excludeReason: wasManuallyExcluded ? manualExclusions.get(key) : null,
              },
            ],
            { session }
          );
          itemsAdded++;
        }
      }

      for (const adjustment of eligibleAdjustments) {
        const key = adjustment._id.toString();
        if (!existingItemKeys.has(key)) {
          // New eligible adjustment, add it
          const wasManuallyExcluded = manualExclusions.has(key);
          await PayRunItem.create(
            [
              {
                payrunId: new mongoose.Types.ObjectId(payRunId),
                driverId: new mongoose.Types.ObjectId(adjustment.driverId),
                kind: "ADJUSTMENT",
                jobId: null,
                driverAdjustmentId: new mongoose.Types.ObjectId(adjustment._id),
                description: adjustment.description || `Adjustment ${adjustment._id}`,
                amount: parseFloat(adjustment.amount || 0),
                excluded: wasManuallyExcluded,
                excludeReason: wasManuallyExcluded ? manualExclusions.get(key) : null,
              },
            ],
            { session }
          );
          itemsAdded++;
        }
      }

      // Recalculate driver totals
      const driverTotals = await PayRunItem.aggregate([
        {
          $match: {
            payrunId: new mongoose.Types.ObjectId(payRunId),
            excluded: false,
          },
        },
        {
          $group: {
            _id: "$driverId",
            gross: {
              $sum: {
                $cond: [{ $eq: ["$kind", "JOB"] }, "$amount", 0],
              },
            },
            adjustments: {
              $sum: {
                $cond: [{ $eq: ["$kind", "ADJUSTMENT"] }, "$amount", 0],
              },
            },
          },
        },
      ]).session(session);

      // Update or create driver summaries
      for (const total of driverTotals) {
        const netPay = (total.gross || 0) + (total.adjustments || 0);
        await PayRunDriver.findOneAndUpdate(
          {
            payrunId: new mongoose.Types.ObjectId(payRunId),
            driverId: total._id,
          },
          {
            payrunId: new mongoose.Types.ObjectId(payRunId),
            driverId: total._id,
            gross: total.gross || 0,
            adjustments: total.adjustments || 0,
            netPay: netPay,
            totalAmount: netPay, // Backward compatibility
          },
          { upsert: true, session }
        );
      }

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      return {
        success: true,
        data: {
          id: payRun._id.toString(),
          status: payRun.status,
          itemsAdded,
          itemsRemoved,
          itemsUpdated,
          message: "Pay run rebuilt successfully",
        },
      };
    } catch (error) {
      // Only abort if transaction was started
      if (transactionStarted) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          // Ignore if already aborted
          console.warn("Transaction already aborted:", abortError.message);
        }
      }
      try {
        await session.endSession();
      } catch (endError) {
        // Ignore if session already ended
        console.warn("Session already ended:", endError.message);
      }
      throw error;
    }
  }
}

module.exports = PayRunService;

