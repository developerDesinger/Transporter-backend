const Assignment = require("../models/assignment.model");
const Customer = require("../models/customer.model");
const Driver = require("../models/driver.model");
const Invoice = require("../models/invoice.model");
const InvoicePayment = require("../models/invoicePayment.model");
const Job = require("../models/job.model");
const Party = require("../models/party.model");
const PayRun = require("../models/payRun.model");
const PayRunDriver = require("../models/payRunDriver.model");
const User = require("../models/user.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

class ReportService {
  /**
   * Get customer churn report
   * @param {Object} query - Query parameters (inactiveDays)
   * @param {Object} user - Authenticated user
   * @returns {Object} Customer churn report data
   */
  static async getCustomerChurnReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Parse inactiveDays parameter (default to 30)
    const inactiveDays = parseInt(query.inactiveDays) || 30;

    // Validate inactiveDays
    if (isNaN(inactiveDays) || inactiveDays < 1) {
      throw new AppError(
        "inactiveDays must be a positive number",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Calculate today's date (start of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build aggregation pipeline to get customer activity metrics
    const pipeline = [];

    // Match stage: Filter by organization and active customers
    const matchConditions = [
      {
        isActive: true,
      },
    ];

    // Note: Customer model doesn't have organizationId directly
    // If organization filtering is needed, it should be added to Customer model
    // For now, we'll filter jobs by organizationId

    const matchStage =
      matchConditions.length > 1
        ? { $and: matchConditions }
        : matchConditions[0];

    pipeline.push({ $match: matchStage });

    // Lookup stage: Join with Party to get company name
    pipeline.push({
      $lookup: {
        from: "parties",
        localField: "partyId",
        foreignField: "_id",
        as: "party",
      },
    });

    // Unwind party array
    pipeline.push({
      $unwind: {
        path: "$party",
        preserveNullAndEmptyArrays: true,
      },
    });

    // Build job match conditions
    const jobMatchConditions = [
      { $expr: { $eq: ["$customerId", "$$customerId"] } },
      { $eq: ["$status", "CLOSED"] }, // Only completed jobs
    ];

    // Add organization filter if available
    if (organizationId) {
      jobMatchConditions.push({
        $eq: ["$organizationId", new mongoose.Types.ObjectId(organizationId)],
      });
    } else {
      jobMatchConditions.push({
        $or: [
          { $eq: ["$organizationId", null] },
          { $eq: ["$organizationId", undefined] },
        ],
      });
    }

    // Lookup stage: Join with Jobs to get job statistics
    pipeline.push({
      $lookup: {
        from: "jobs",
        let: { customerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: jobMatchConditions,
              },
            },
          },
          {
            $project: {
              date: 1,
              completedAt: 1,
              closedAt: 1,
              customerCharge: 1,
              totalAmount: 1,
              invoiceAmount: 1,
            },
          },
        ],
        as: "jobs",
      },
    });

    // Calculate job statistics and last job date
    pipeline.push({
      $addFields: {
        totalJobs: { $size: "$jobs" },
        totalRevenue: {
          $sum: {
            $map: {
              input: "$jobs",
              as: "job",
              in: {
                $ifNull: [
                  "$$job.customerCharge",
                  {
                    $ifNull: [
                      "$$job.totalAmount",
                      {
                        $ifNull: ["$$job.invoiceAmount", 0],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        lastJobDate: {
          $let: {
            vars: {
              dates: {
                $map: {
                  input: "$jobs",
                  as: "job",
                  in: {
                    $cond: {
                      if: { $ne: ["$$job.completedAt", null] },
                      then: "$$job.completedAt",
                      else: {
                        $cond: {
                          if: { $ne: ["$$job.closedAt", null] },
                          then: "$$job.closedAt",
                          else: {
                            // Convert date string (YYYY-MM-DD) to Date
                            $cond: {
                              if: { $ne: ["$$job.date", null] },
                              then: {
                                $dateFromString: {
                                  dateString: {
                                    $concat: ["$$job.date", "T00:00:00.000Z"],
                                  },
                                  onError: null,
                                },
                              },
                              else: null,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            in: {
              $cond: {
                if: { $gt: [{ $size: "$$dates" }, 0] },
                then: { $max: "$$dates" },
                else: null,
              },
            },
          },
        },
      },
    });

    // Calculate days since last job
    // Convert today to milliseconds since epoch
    const todayMs = today.getTime();
    pipeline.push({
      $addFields: {
        daysSinceLastJob: {
          $cond: {
            if: { $ne: ["$lastJobDate", null] },
            then: {
              $floor: {
                $divide: [
                  {
                    $subtract: [
                      todayMs,
                      {
                        $toLong: "$lastJobDate",
                      },
                    ],
                  },
                  1000 * 60 * 60 * 24, // milliseconds to days
                ],
              },
            },
            else: inactiveDays + 1, // Customer with no jobs is considered inactive
          },
        },
      },
    });

    // Calculate churn risk
    pipeline.push({
      $addFields: {
        churnRisk: {
          $cond: {
            // HIGH: daysSinceLastJob >= inactiveDays
            if: { $gte: ["$daysSinceLastJob", inactiveDays] },
            then: "HIGH",
            else: {
              $cond: {
                // HIGH: daysSinceLastJob >= inactiveDays * 0.8 AND totalJobs < 10
                if: {
                  $and: [
                    { $gte: ["$daysSinceLastJob", inactiveDays * 0.8] },
                    { $lt: ["$totalJobs", 10] },
                  ],
                },
                then: "HIGH",
                else: {
                  $cond: {
                    // MEDIUM: daysSinceLastJob >= inactiveDays * 0.6
                    if: { $gte: ["$daysSinceLastJob", inactiveDays * 0.6] },
                    then: "MEDIUM",
                    else: {
                      $cond: {
                        // LOW: Established customer (totalJobs > 50 AND totalRevenue > 100000)
                        if: {
                          $and: [
                            { $gt: ["$totalJobs", 50] },
                            { $gt: ["$totalRevenue", 100000] },
                          ],
                        },
                        then: "LOW",
                        else: "LOW",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Filter customers with churn risk (daysSinceLastJob >= inactiveDays * 0.6 OR churnRisk === 'HIGH')
    pipeline.push({
      $match: {
        $or: [
          { daysSinceLastJob: { $gte: inactiveDays * 0.6 } },
          { churnRisk: "HIGH" },
        ],
      },
    });

    // Project final fields
    pipeline.push({
      $project: {
        customerId: { $toString: "$_id" },
        customerName: {
          $ifNull: [
            "$party.companyName",
            {
              $ifNull: [
                "$tradingName",
                {
                  $ifNull: ["$legalCompanyName", "Unknown"],
                },
              ],
            },
          ],
        },
        lastJobDate: {
          $cond: {
            if: { $ne: ["$lastJobDate", null] },
            then: {
              $dateToString: {
                date: "$lastJobDate",
                format: "%Y-%m-%dT%H:%M:%S.%LZ",
              },
            },
            else: null,
          },
        },
        totalJobs: 1,
        totalRevenue: {
          $toString: {
            $round: ["$totalRevenue", 2],
          },
        },
        daysSinceLastJob: 1,
        churnRisk: 1,
      },
    });

    // Sort by daysSinceLastJob descending (most inactive first)
    pipeline.push({
      $sort: { daysSinceLastJob: -1 },
    });

    // Execute aggregation
    const customers = await Customer.aggregate(pipeline);

    return {
      customers,
    };
  }

  /**
   * Get banned entities report
   * @param {Object} user - Authenticated user
   * @returns {Object} Banned entities report data
   */
  static async getBannedEntitiesReport(user) {
    const organizationId = user.activeOrganizationId || null;

    // Build query filters for banned entities
    // Note: Driver and Customer models may not have explicit ban fields
    // We'll check for common patterns: status='BANNED' or isBanned=true
    const driverFilter = {
      $or: [
        { status: "BANNED" },
        { isBanned: true },
        // If no explicit ban fields, we might need to check other indicators
        // For now, we'll only return entities with explicit ban status
      ],
    };

    const customerFilter = {
      $or: [
        { status: "BANNED" },
        { isBanned: true },
      ],
    };

    // Note: Driver and Customer models don't have organizationId directly
    // If organizationId filtering is needed, it may need to be added to the models
    // For now, we'll query all banned entities
    // TODO: Add organizationId to Driver and Customer models if multi-tenancy is required

    // Query banned drivers
    const bannedDrivers = await Driver.find(driverFilter)
      .populate({
        path: "partyId",
        model: "Party",
        select: "firstName lastName companyName",
      })
      .populate({
        path: "bannedByUserId",
        model: "User",
        select: "fullName name email",
      })
      .lean();

    // Query banned customers
    const bannedCustomers = await Customer.find(customerFilter)
      .populate({
        path: "partyId",
        model: "Party",
        select: "companyName firstName lastName",
      })
      .populate({
        path: "bannedByUserId",
        model: "User",
        select: "fullName name email",
      })
      .lean();

    // Format banned drivers
    const formattedDrivers = bannedDrivers.map((driver) => {
      const party = driver.partyId || {};
      const bannedBy = driver.bannedByUserId || {};

      // Determine name
      let name = "Unknown Driver";
      if (party.companyName) {
        name = party.companyName;
      } else if (party.firstName && party.lastName) {
        name = `${party.firstName} ${party.lastName}`;
      } else if (driver.driverCode) {
        name = driver.driverCode;
      }

      // Get bannedBy name
      let bannedByName = "Unknown";
      if (bannedBy.fullName) {
        bannedByName = bannedBy.fullName;
      } else if (bannedBy.name) {
        bannedByName = bannedBy.name;
      } else if (bannedBy.email) {
        bannedByName = bannedBy.email;
      }

      return {
        id: driver._id.toString(),
        entityType: "driver",
        name: name,
        reason: driver.banReason || driver.reason || "No reason provided",
        bannedDate: driver.bannedDate
          ? new Date(driver.bannedDate).toISOString()
          : null,
        bannedBy: bannedByName,
      };
    });

    // Format banned customers
    const formattedCustomers = bannedCustomers.map((customer) => {
      const party = customer.partyId || {};
      const bannedBy = customer.bannedByUserId || {};

      // Determine name
      let name = "Unknown Customer";
      if (party.companyName) {
        name = party.companyName;
      } else if (customer.tradingName) {
        name = customer.tradingName;
      } else if (customer.legalCompanyName) {
        name = customer.legalCompanyName;
      } else if (party.firstName && party.lastName) {
        name = `${party.firstName} ${party.lastName}`;
      }

      // Get bannedBy name
      let bannedByName = "Unknown";
      if (bannedBy.fullName) {
        bannedByName = bannedBy.fullName;
      } else if (bannedBy.name) {
        bannedByName = bannedBy.name;
      } else if (bannedBy.email) {
        bannedByName = bannedBy.email;
      }

      return {
        id: customer._id.toString(),
        entityType: "CUSTOMER",
        name: name,
        reason: customer.banReason || customer.reason || "No reason provided",
        bannedDate: customer.bannedDate
          ? new Date(customer.bannedDate).toISOString()
          : null,
        bannedBy: bannedByName,
      };
    });

    // Combine and sort by bannedDate descending (most recent first)
    const allBannedEntities = [...formattedDrivers, ...formattedCustomers];
    allBannedEntities.sort((a, b) => {
      const dateA = a.bannedDate ? new Date(a.bannedDate) : new Date(0);
      const dateB = b.bannedDate ? new Date(b.bannedDate) : new Date(0);
      return dateB - dateA; // Descending (most recent first)
    });

    return {
      entities: allBannedEntities,
    };
  }

  /**
   * Get invoices report
   * @param {Object} query - Query parameters (startDate, endDate, statusFilter, searchTerm)
   * @param {Object} user - Authenticated user
   * @returns {Object} Invoices report data
   */
  static async getInvoicesReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates
    const startDate = new Date(query.startDate + "T00:00:00.000Z");
    const endDate = new Date(query.endDate + "T23:59:59.999Z");

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date range
    if (endDate < startDate) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse optional parameters
    const statusFilter = query.statusFilter || "ALL";
    const searchTerm = (query.searchTerm || "").trim();

    // Build query filter
    const filter = {
      issueDate: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add organization filter
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Add status filter
    if (statusFilter !== "ALL") {
      filter.status = statusFilter;
    }

    // Add search filter for invoice number
    if (searchTerm) {
      filter.invoiceNo = {
        $regex: searchTerm,
        $options: "i", // Case-insensitive
      };
    }

    // Query invoices with customer and party information
    let invoices = await Invoice.find(filter)
      .populate({
        path: "customerId",
        select: "partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ issueDate: -1, createdAt: -1 })
      .lean();

    // Apply customer name search filter if searchTerm provided
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      invoices = invoices.filter((invoice) => {
        const customer = invoice.customerId;
        const party = customer?.partyId || {};
        const customerName =
          party.companyName ||
          (party.firstName && party.lastName
            ? `${party.firstName} ${party.lastName}`
            : "");

        // Check if invoice number matches (already filtered) OR customer name matches
        return (
          invoice.invoiceNo.toLowerCase().includes(searchLower) ||
          customerName.toLowerCase().includes(searchLower)
        );
      });
    }

    // Get invoice IDs for payment calculation
    const invoiceIds = invoices.map((inv) => inv._id);

    // Calculate total paid per invoice
    const paymentMatchFilter = {
      invoiceId: { $in: invoiceIds },
    };

    // Add organization filter if available
    if (organizationId) {
      paymentMatchFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      paymentMatchFilter.organizationId = null;
    }

    const payments = await InvoicePayment.aggregate([
      {
        $match: paymentMatchFilter,
      },
      {
        $group: {
          _id: "$invoiceId",
          totalPaid: { $sum: "$amount" },
        },
      },
    ]);

    // Create map of total paid by invoice ID
    const paymentsByInvoice = {};
    payments.forEach((payment) => {
      paymentsByInvoice[payment._id.toString()] = payment.totalPaid || 0;
    });

    // Format invoices
    const formattedInvoices = invoices.map((invoice) => {
      const customer = invoice.customerId || {};
      const party = customer.partyId || {};

      // Get customer name
      let customerName = "Unknown Customer";
      if (party.companyName) {
        customerName = party.companyName;
      } else if (party.firstName && party.lastName) {
        customerName = `${party.firstName} ${party.lastName}`;
      }

      // Calculate balance due
      const totalPaid = paymentsByInvoice[invoice._id.toString()] || 0;
      // Use invoice.balanceDue if available, otherwise calculate from totalIncGst - totalPaid
      const balanceDue =
        invoice.balanceDue !== undefined
          ? invoice.balanceDue
          : Math.max(0, (invoice.totalIncGst || 0) - totalPaid);

      return {
        id: invoice._id.toString(),
        invoiceNo: invoice.invoiceNo,
        customerName: customerName,
        issueDate: invoice.issueDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        totalIncGst: (invoice.totalIncGst || 0).toFixed(2),
        balanceDue: Math.max(0, balanceDue).toFixed(2), // Ensure non-negative
        status: invoice.status,
      };
    });

    return {
      invoices: formattedInvoices,
    };
  }

  /**
   * Get pay runs report
   * @param {Object} query - Query parameters (startDate, endDate, statusFilter)
   * @param {Object} user - Authenticated user
   * @returns {Object} Pay runs report data
   */
  static async getPayRunsReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates
    const startDate = new Date(query.startDate + "T00:00:00.000Z");
    const endDate = new Date(query.endDate + "T23:59:59.999Z");

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date range
    if (endDate < startDate) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse optional parameters
    const statusFilter = query.statusFilter || "ALL";

    // Build query filter
    const filter = {
      // Period overlap: periodStart <= endDate AND periodEnd >= startDate
      periodStart: { $lte: endDate },
      periodEnd: { $gte: startDate },
    };

    // Add organization filter
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Add status filter
    if (statusFilter !== "ALL") {
      filter.status = statusFilter;
    }

    // Query pay runs
    const payRuns = await PayRun.find(filter)
      .sort({ periodStart: -1, createdAt: -1 })
      .lean();

    // Get pay run IDs for calculating totals
    const payRunIds = payRuns.map((pr) => pr._id);

    // Calculate totals using PayRunDriver aggregation
    const totalsByPayRun = {};
    if (payRunIds.length > 0) {
      const payRunDriverFilter = {
        payrunId: { $in: payRunIds },
      };

      // Add organization filter if needed (PayRunDriver might not have organizationId directly)
      // We'll filter by payrunId which already has organizationId

      const driverTotals = await PayRunDriver.aggregate([
        {
          $match: payRunDriverFilter,
        },
        {
          $group: {
            _id: "$payrunId",
            totalDrivers: { $addToSet: "$driverId" }, // Get unique driver IDs
            totalGross: { $sum: "$gross" }, // Sum of gross amounts
          },
        },
      ]);

      // Process aggregation results
      driverTotals.forEach((total) => {
        totalsByPayRun[total._id.toString()] = {
          totalDrivers: total.totalDrivers.length,
          totalGross: total.totalGross || 0,
        };
      });
    }

    // Format pay runs
    const formattedPayRuns = payRuns.map((payRun) => {
      const totals = totalsByPayRun[payRun._id.toString()] || {
        totalDrivers: 0,
        totalGross: 0,
      };

      // Use calculated totals if available, otherwise fall back to stored values
      const totalDrivers = totals.totalDrivers || 0;
      const totalGross = totals.totalGross || payRun.totalAmount || 0;

      return {
        id: payRun._id.toString(),
        label: payRun.label || `Pay Run ${payRun.payRunNumber || payRun._id.toString().slice(-6)}`,
        periodStart: payRun.periodStart.toISOString(),
        periodEnd: payRun.periodEnd.toISOString(),
        totaldrivers: totalDrivers,
        totalGross: totalGross.toFixed(2),
        status: payRun.status,
      };
    });

    return {
      payRuns: formattedPayRuns,
    };
  }

  /**
   * Get margins report
   * @param {Object} query - Query parameters (startDate, endDate, jobTypeFilter)
   * @param {Object} user - Authenticated user
   * @returns {Object} Margins report data
   */
  static async getMarginsReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates
    const startDate = query.startDate; // Keep as string for comparison with job.date
    const endDate = query.endDate;

    // Validate date range
    const startDateObj = new Date(startDate + "T00:00:00.000Z");
    const endDateObj = new Date(endDate + "T23:59:59.999Z");

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (endDateObj < startDateObj) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse optional parameters
    const jobTypeFilter = query.jobTypeFilter || "ALL";

    // Build query filter
    const filter = {
      status: "CLOSED", // Only include closed/completed jobs
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add organization filter
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Add job type filter (map jobTypeFilter to boardType)
    if (jobTypeFilter !== "ALL") {
      // Map HOURLY -> PUD, FTL -> LINEHAUL
      if (jobTypeFilter === "HOURLY") {
        filter.boardType = "PUD";
      } else if (jobTypeFilter === "FTL") {
        filter.boardType = "LINEHAUL";
      } else {
        // If it's a different value, try to match directly
        filter.boardType = jobTypeFilter;
      }
    }

    // Query jobs with customer and party information
    const jobs = await Job.find(filter)
      .populate({
        path: "customerId",
        select: "partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    // Format margins
    const formattedMargins = jobs.map((job) => {
      const customer = job.customerId || {};
      const party = customer.partyId || {};

      // Get customer name
      let customerName = "Unknown Customer";
      if (party.companyName) {
        customerName = party.companyName;
      } else if (party.firstName && party.lastName) {
        customerName = `${party.firstName} ${party.lastName}`;
      }

      // Map boardType to jobType
      const jobType = job.boardType === "LINEHAUL" ? "FTL" : "HOURLY";

      // Calculate revenue (use customerCharge as primary, with fallbacks)
      const revenue =
        job.customerCharge ||
        job.totalAmount ||
        job.invoiceAmount ||
        job.baseCharge ||
        0;

      // Calculate cost (use driverPay)
      const cost = job.driverPay || 0;

      // Calculate margin
      const margin = revenue - cost;

      // Calculate margin percentage
      const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

      // Convert date string to ISO date for serviceDate
      const serviceDate = job.date
        ? new Date(job.date + "T00:00:00.000Z").toISOString()
        : new Date().toISOString();

      return {
        id: job._id.toString(),
        jobNumber: job.jobNumber,
        customerName: customerName,
        serviceDate: serviceDate,
        jobType: jobType,
        revenue: revenue.toFixed(2),
        cost: cost.toFixed(2),
        margin: margin.toFixed(2),
        marginPercent: marginPercent.toFixed(2),
      };
    });

    return {
      margins: formattedMargins,
    };
  }

  /**
   * Get jobs report
   * @param {Object} query - Query parameters (startDate, endDate, jobTypeFilter, searchTerm)
   * @param {Object} user - Authenticated user
   * @returns {Object} Jobs report data
   */
  static async getJobsReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates
    const startDate = query.startDate; // Keep as string for comparison with job.date
    const endDate = query.endDate;

    // Validate date range
    const startDateObj = new Date(startDate + "T00:00:00.000Z");
    const endDateObj = new Date(endDate + "T23:59:59.999Z");

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (endDateObj < startDateObj) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse optional parameters
    const jobTypeFilter = query.jobTypeFilter || "ALL";
    const searchTerm = (query.searchTerm || "").trim();

    // Build query filter
    const filter = {
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add organization filter
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Add job type filter (map jobTypeFilter to boardType)
    if (jobTypeFilter !== "ALL") {
      // Map HOURLY -> PUD, FTL -> LINEHAUL
      if (jobTypeFilter === "HOURLY") {
        filter.boardType = "PUD";
      } else if (jobTypeFilter === "FTL") {
        filter.boardType = "LINEHAUL";
      } else {
        // If it's a different value, try to match directly
        filter.boardType = jobTypeFilter;
      }
    }

    // Add search filter for job number
    if (searchTerm) {
      filter.jobNumber = {
        $regex: searchTerm,
        $options: "i", // Case-insensitive
      };
    }

    // Query jobs with customer and party information
    let jobs = await Job.find(filter)
      .populate({
        path: "customerId",
        select: "partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    // Apply customer name search filter if searchTerm provided
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      jobs = jobs.filter((job) => {
        const customer = job.customerId;
        const party = customer?.partyId || {};
        const customerName =
          party.companyName ||
          (party.firstName && party.lastName
            ? `${party.firstName} ${party.lastName}`
            : "");

        // Check if job number matches (already filtered) OR customer name matches
        return (
          job.jobNumber.toLowerCase().includes(searchLower) ||
          customerName.toLowerCase().includes(searchLower)
        );
      });
    }

    // Format jobs
    const formattedJobs = jobs.map((job) => {
      const customer = job.customerId || {};
      const party = customer.partyId || {};

      // Get customer name
      let customerName = "Unknown Customer";
      if (party.companyName) {
        customerName = party.companyName;
      } else if (party.firstName && party.lastName) {
        customerName = `${party.firstName} ${party.lastName}`;
      }

      // Map boardType to jobType
      const jobType = job.boardType === "LINEHAUL" ? "FTL" : "HOURLY";

      // Map status: OPEN -> OPEN, CLOSED -> COMPLETED (or keep as CLOSED)
      // The guide shows "COMPLETED" but model has "CLOSED", we'll use the model value
      const status = job.status === "CLOSED" ? "COMPLETED" : job.status;

      // Calculate revenue (use customerCharge as primary, with fallbacks)
      const revenue =
        job.customerCharge ||
        job.totalAmount ||
        job.invoiceAmount ||
        job.baseCharge ||
        0;

      // Calculate cost (use driverPay)
      const cost = job.driverPay || 0;

      // Calculate margin
      const margin = revenue - cost;

      // Convert date string to ISO date for serviceDate
      const serviceDate = job.date
        ? new Date(job.date + "T00:00:00.000Z").toISOString()
        : new Date().toISOString();

      return {
        id: job._id.toString(),
        jobNumber: job.jobNumber,
        customerName: customerName,
        serviceDate: serviceDate,
        jobType: jobType,
        status: status,
        revenue: revenue.toFixed(2),
        cost: cost.toFixed(2),
        margin: margin.toFixed(2),
      };
    });

    return {
      jobs: formattedJobs,
    };
  }

  /**
   * Get driver hours report
   * @param {Object} query - Query parameters (startDate, endDate)
   * @param {Object} user - Authenticated user
   * @returns {Object} Driver hours report data
   */
  static async getDriverHoursReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates
    const startDate = query.startDate; // Keep as string for comparison with job.date
    const endDate = query.endDate;

    // Validate date range
    const startDateObj = new Date(startDate + "T00:00:00.000Z");
    const endDateObj = new Date(endDate + "T23:59:59.999Z");

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (endDateObj < startDateObj) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Query jobs in date range with CLOSED status
    const jobFilter = {
      status: "CLOSED", // Only include closed/completed jobs
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add organization filter
    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    // Get job IDs
    const jobs = await Job.find(jobFilter).select("_id date").lean();
    const jobIds = jobs.map((j) => j._id);

    if (jobIds.length === 0) {
      return {
        driverHours: [],
      };
    }

    // Query assignments for these jobs with startTime and finishTime
    const assignmentFilter = {
      jobId: { $in: jobIds },
      startTime: { $exists: true, $ne: null },
      finishTime: { $exists: true, $ne: null },
    };

    // Add organization filter
    if (organizationId) {
      assignmentFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      assignmentFilter.organizationId = null;
    }

    const assignments = await Assignment.find(assignmentFilter)
      .populate({
        path: "driverId",
        select: "partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .populate("jobId", "date")
      .lean();

    // Create a map of job dates by jobId for quick lookup
    const jobDatesMap = {};
    jobs.forEach((job) => {
      jobDatesMap[job._id.toString()] = job.date;
    });

    // Aggregate by driver
    const driverData = {};

    assignments.forEach((assignment) => {
      const driverId = assignment.driverId?._id?.toString();
      if (!driverId) return;

      if (!driverData[driverId]) {
        driverData[driverId] = {
          driver: assignment.driverId,
          totalHours: 0,
          totalJobs: 0,
          lastJobDate: null,
        };
      }

      // Calculate hours from startTime and finishTime
      const startTime = new Date(assignment.startTime);
      const finishTime = new Date(assignment.finishTime);
      const breakMinutes = assignment.breakMinutes || 0;

      // Calculate hours: (finishTime - startTime) / (1000 * 60 * 60) - (breakMinutes / 60)
      const hours =
        (finishTime - startTime) / (1000 * 60 * 60) - breakMinutes / 60;

      // Ensure non-negative hours
      driverData[driverId].totalHours += Math.max(0, hours);
      driverData[driverId].totalJobs += 1;

      // Get job date from the map
      const jobIdStr = assignment.jobId?._id?.toString() || assignment.jobId?.toString();
      const jobDate = jobDatesMap[jobIdStr] || assignment.jobId?.date;

      // Update last job date if this job is more recent
      if (jobDate) {
        const jobDateObj = new Date(jobDate + "T00:00:00.000Z");
        if (
          !driverData[driverId].lastJobDate ||
          jobDateObj > new Date(driverData[driverId].lastJobDate + "T00:00:00.000Z")
        ) {
          driverData[driverId].lastJobDate = jobDate;
        }
      }
    });

    // Format response
    const formattedDriverHours = Object.values(driverData).map((data) => {
      const party = data.driver?.partyId || {};

      // Get driver name
      let driverName = "Unknown Driver";
      if (party.companyName) {
        driverName = party.companyName;
      } else if (party.firstName && party.lastName) {
        driverName = `${party.firstName} ${party.lastName}`;
      } else if (party.firstName) {
        driverName = party.firstName;
      } else if (party.lastName) {
        driverName = party.lastName;
      }

      // Calculate average hours per job
      const averageHoursPerJob =
        data.totalJobs > 0 ? data.totalHours / data.totalJobs : 0;

      // Format last job date
      const lastJobDate = data.lastJobDate
        ? new Date(data.lastJobDate + "T00:00:00.000Z").toISOString()
        : null;

      return {
        driverId: data.driver._id.toString(),
        driverName: driverName,
        totalHours: data.totalHours.toFixed(2),
        totalJobs: data.totalJobs,
        averageHoursPerJob: averageHoursPerJob.toFixed(2),
        lastJobDate: lastJobDate,
      };
    });

    // Sort by total hours descending
    formattedDriverHours.sort(
      (a, b) => parseFloat(b.totalHours) - parseFloat(a.totalHours)
    );

    return {
      driverHours: formattedDriverHours,
    };
  }

  /**
   * Get fatigue report
   * @param {Object} query - Query parameters (startDate, endDate)
   * @param {Object} user - Authenticated user
   * @returns {Object} Fatigue report data
   */
  static async getFatigueReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates
    const startDate = query.startDate; // Keep as string for comparison with job.date
    const endDate = query.endDate;

    // Validate date range
    const startDateObj = new Date(startDate + "T00:00:00.000Z");
    const endDateObj = new Date(endDate + "T23:59:59.999Z");

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (endDateObj < startDateObj) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Query jobs in date range with CLOSED status
    const jobFilter = {
      status: "CLOSED", // Only include closed/completed jobs
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add organization filter
    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    // Get job IDs and dates
    const jobs = await Job.find(jobFilter).select("_id date").lean();
    const jobIds = jobs.map((j) => j._id);

    if (jobIds.length === 0) {
      return {
        reports: [],
      };
    }

    // Create a map of job dates by jobId for quick lookup
    const jobDatesMap = {};
    jobs.forEach((job) => {
      jobDatesMap[job._id.toString()] = job.date;
    });

    // Query assignments for these jobs with startTime and finishTime
    const assignmentFilter = {
      jobId: { $in: jobIds },
      startTime: { $exists: true, $ne: null },
      finishTime: { $exists: true, $ne: null },
    };

    // Add organization filter
    if (organizationId) {
      assignmentFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      assignmentFilter.organizationId = null;
    }

    const assignments = await Assignment.find(assignmentFilter)
      .populate({
        path: "driverId",
        select: "partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .lean();

    // Aggregate by driver and date
    const driverDateData = {};

    assignments.forEach((assignment) => {
      const driverId = assignment.driverId?._id?.toString();
      if (!driverId) return;

      // Get job date from the map
      const jobIdStr = assignment.jobId?.toString();
      const jobDate = jobDatesMap[jobIdStr];

      if (!jobDate) return;

      // Create a unique key for driver-date combination
      const dateKey = `${driverId}_${jobDate}`;

      if (!driverDateData[dateKey]) {
        driverDateData[dateKey] = {
          driver: assignment.driverId,
          date: jobDate,
          totalWork: 0,
        };
      }

      // Calculate hours from startTime and finishTime
      const startTime = new Date(assignment.startTime);
      const finishTime = new Date(assignment.finishTime);
      const breakMinutes = assignment.breakMinutes || 0;

      // Calculate hours: (finishTime - startTime) / (1000 * 60 * 60) - (breakMinutes / 60)
      const hours =
        (finishTime - startTime) / (1000 * 60 * 60) - breakMinutes / 60;

      // Ensure non-negative hours and add to total work
      driverDateData[dateKey].totalWork += Math.max(0, hours);
    });

    // Calculate rest hours and determine fatigue levels
    const formattedReports = Object.values(driverDateData).map((data) => {
      const party = data.driver?.partyId || {};

      // Get driver name
      let driverName = "Unknown Driver";
      if (party.companyName) {
        driverName = party.companyName;
      } else if (party.firstName && party.lastName) {
        driverName = `${party.firstName} ${party.lastName}`;
      } else if (party.firstName) {
        driverName = party.firstName;
      } else if (party.lastName) {
        driverName = party.lastName;
      }

      // Calculate total work and rest hours
      const totalWork = data.totalWork;
      const totalRest = 24 - totalWork; // Simplified calculation

      // Determine fatigue level
      let fatigueLevel = "LOW";
      let status = "OK";

      // HIGH: Work hours >= 14 OR rest hours < 10
      if (totalWork >= 14 || totalRest < 10) {
        fatigueLevel = "HIGH";
        status = "CRITICAL";
      }
      // MEDIUM: Work hours >= 10 AND < 14 AND rest hours < 14
      else if (totalWork >= 10 && totalWork < 14 && totalRest < 14) {
        fatigueLevel = "MEDIUM";
        status = "WARNING";
      }
      // LOW: Work hours < 10 OR rest hours >= 14
      // (This is the default, already set above)

      // Format assessment date
      const assessmentDate = data.date
        ? new Date(data.date + "T00:00:00.000Z").toISOString()
        : new Date().toISOString();

      return {
        driverId: data.driver._id.toString(),
        driverName: driverName,
        assessmentDate: assessmentDate,
        totalWork: totalWork.toFixed(2),
        totalRest: Math.max(0, totalRest).toFixed(2), // Ensure non-negative
        fatigueLevel: fatigueLevel,
        status: status,
      };
    });

    // Sort by assessment date descending, then by fatigue level (HIGH first)
    formattedReports.sort((a, b) => {
      // First sort by assessment date (descending)
      const dateA = new Date(a.assessmentDate);
      const dateB = new Date(b.assessmentDate);
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB - dateA;
      }

      // Then sort by fatigue level (HIGH > MEDIUM > LOW)
      const levelOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return levelOrder[b.fatigueLevel] - levelOrder[a.fatigueLevel];
    });

    return {
      reports: formattedReports,
    };
  }

  /**
   * Get open jobs grouped by service date
   * @param {Object} query - Query parameters (startDate, endDate)
   * @param {Object} user - Authenticated user
   * @returns {Object} Open jobs grouped data
   */
  static async getOpenJobsReport(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Validate required parameters
    if (!query.startDate || !query.endDate) {
      throw new AppError(
        "startDate and endDate are required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(query.startDate) || !dateRegex.test(query.endDate)) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Parse dates for validation
    const startDate = query.startDate;
    const endDate = query.endDate;
    const startDateObj = new Date(startDate + "T00:00:00.000Z");
    const endDateObj = new Date(endDate + "T23:59:59.999Z");

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new AppError(
        "Invalid date format. Use YYYY-MM-DD",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (endDateObj < startDateObj) {
      throw new AppError(
        "endDate must be greater than or equal to startDate",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Build job filter for open jobs
    const closedStatuses = ["CLOSED", "COMPLETED", "CANCELLED", "INVOICED"];
    const jobFilter = {
      date: {
        $gte: startDate,
        $lte: endDate,
      },
      status: { $nin: closedStatuses },
    };

    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    // Query jobs (only select needed fields)
    const jobs = await Job.find(jobFilter).select("_id date status").lean();

    if (jobs.length === 0) {
      return {
        jobs: [],
      };
    }

    // Fetch assignments for these jobs
    const jobIds = jobs.map((job) => job._id);
    const assignments = await Assignment.find({
      jobId: { $in: jobIds },
    })
      .select("jobId startTime finishTime")
      .lean();

    const assignmentMap = new Map();
    assignments.forEach((assignment) => {
      const jobIdStr = assignment.jobId.toString();
      if (!assignmentMap.has(jobIdStr)) {
        assignmentMap.set(jobIdStr, []);
      }
      assignmentMap.get(jobIdStr).push(assignment);
    });

    // Group jobs by service date
    const jobsByDate = {};

    jobs.forEach((job) => {
      const jobIdStr = job._id.toString();
      const jobDate = job.date || null;
      if (!jobDate) {
        return;
      }

      const assignmentsForJob = assignmentMap.get(jobIdStr) || [];
      const hasAssignment = assignmentsForJob.length > 0;
      const hasCompletedAssignment = assignmentsForJob.some(
        (assignment) => assignment.finishTime
      );

      // Derive status categories based on assignments
      let derivedStatus = "OPEN";
      if (hasAssignment && hasCompletedAssignment) {
        derivedStatus = "READY_TO_CLOSE";
      } else if (hasAssignment) {
        derivedStatus = "ASSIGNED";
      }

      // Initialize buckets per date
      if (!jobsByDate[jobDate]) {
        const serviceDateISO = new Date(
          jobDate + "T00:00:00.000Z"
        ).toISOString();
        jobsByDate[jobDate] = {
          serviceDate: serviceDateISO,
          openCount: 0,
          assignedCount: 0,
          readyToCloseCount: 0,
          totalCount: 0,
        };
      }

      const bucket = jobsByDate[jobDate];
      bucket.totalCount += 1;

      if (derivedStatus === "READY_TO_CLOSE") {
        bucket.readyToCloseCount += 1;
      } else {
        // OPEN includes DRAFT/OPEN/ASSIGNED per spec
        bucket.openCount += 1;
      }

      if (derivedStatus === "ASSIGNED") {
        bucket.assignedCount += 1;
      }
    });

    // Format result array
    const formattedJobs = Object.values(jobsByDate).sort(
      (a, b) => new Date(a.serviceDate) - new Date(b.serviceDate)
    );

    return {
      jobs: formattedJobs,
    };
  }

  /**
   * Export report data
   * @param {Object} query - Query parameters (reportType, format, filters)
   * @param {Object} user - Authenticated user
   * @returns {Object} Export file data (buffer, filename, contentType)
   */
  static async exportReport(query, user) {
    const { reportType, format } = query;

    // Validate report type
    const validReportTypes = [
      "invoices",
      "pay-runs",
      "margins",
      "jobs",
      "driver-hours",
      "fatigue",
      "open-jobs",
      "customer-churn",
      "banned-entities",
    ];

    if (!reportType || !validReportTypes.includes(reportType.toLowerCase())) {
      throw new AppError(
        `reportType must be one of: ${validReportTypes.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate format
    const validFormats = ["csv", "excel", "pdf"];
    if (!format || !validFormats.includes(format.toLowerCase())) {
      throw new AppError(
        `format must be one of: ${validFormats.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate dates for date-based reports
    const dateBasedReports = [
      "invoices",
      "pay-runs",
      "margins",
      "jobs",
      "driver-hours",
      "fatigue",
      "open-jobs",
    ];

    if (dateBasedReports.includes(reportType.toLowerCase())) {
      if (!query.startDate || !query.endDate) {
        throw new AppError(
          "startDate and endDate are required for this report type",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    // Fetch report data using existing methods
    let reportData = null;
    const reportTypeLower = reportType.toLowerCase();

    switch (reportTypeLower) {
      case "invoices":
        reportData = await this.getInvoicesReport(query, user);
        break;
      case "pay-runs":
        reportData = await this.getPayRunsReport(query, user);
        break;
      case "margins":
        reportData = await this.getMarginsReport(query, user);
        break;
      case "jobs":
        reportData = await this.getJobsReport(query, user);
        break;
      case "driver-hours":
        reportData = await this.getDriverHoursReport(query, user);
        break;
      case "fatigue":
        reportData = await this.getFatigueReport(query, user);
        break;
      case "open-jobs":
        reportData = await this.getOpenJobsReport(query, user);
        break;
      case "customer-churn":
        reportData = await this.getCustomerChurnReport(query, user);
        break;
      case "banned-entities":
        reportData = await this.getBannedEntitiesReport(user);
        break;
    }

    // Generate export file
    const formatLower = format.toLowerCase();
    let exportResult;

    if (formatLower === "csv") {
      exportResult = this.generateCSV(reportTypeLower, reportData);
    } else if (formatLower === "excel") {
      exportResult = await this.generateExcel(reportTypeLower, reportData);
    } else if (formatLower === "pdf") {
      exportResult = await this.generatePDF(
        reportTypeLower,
        reportData,
        query
      );
    }

    // Generate filename
    const dateStr = query.startDate
      ? `${query.startDate}_to_${query.endDate}`
      : new Date().toISOString().split("T")[0];
    const extension = formatLower === "excel" ? "xlsx" : formatLower;
    const filename = `${reportTypeLower}_${dateStr}.${extension}`;

    return {
      buffer: exportResult.buffer,
      filename: filename,
      contentType: exportResult.contentType,
    };
  }

  /**
   * Generate CSV content
   * @param {string} reportType - Report type
   * @param {Object} data - Report data
   * @returns {Object} CSV buffer and content type
   */
  static generateCSV(reportType, data) {
    let headers = [];
    let rows = [];

    // Extract data array based on report type
    let dataArray = [];
    if (data.invoices) dataArray = data.invoices;
    else if (data.payRuns) dataArray = data.payRuns;
    else if (data.margins) dataArray = data.margins;
    else if (data.jobs) dataArray = data.jobs;
    else if (data.driverHours) dataArray = data.driverHours;
    else if (data.reports) dataArray = data.reports;
    else if (data.customers) dataArray = data.customers;
    else if (data.entities) dataArray = data.entities;

    // Define headers and rows based on report type
    switch (reportType) {
      case "invoices":
        headers = [
          "Invoice No",
          "Customer Name",
          "Issue Date",
          "Due Date",
          "Total (Inc GST)",
          "Balance Due",
          "Status",
        ];
        rows = dataArray.map((item) => [
          item.invoiceNo,
          item.customerName,
          new Date(item.issueDate).toISOString().split("T")[0],
          new Date(item.dueDate).toISOString().split("T")[0],
          item.totalIncGst,
          item.balanceDue,
          item.status,
        ]);
        break;

      case "pay-runs":
        headers = [
          "Label",
          "Period Start",
          "Period End",
          "Total Drivers",
          "Total Gross",
          "Status",
        ];
        rows = dataArray.map((item) => [
          item.label,
          new Date(item.periodStart).toISOString().split("T")[0],
          new Date(item.periodEnd).toISOString().split("T")[0],
          item.totaldrivers,
          item.totalGross,
          item.status,
        ]);
        break;

      case "margins":
        headers = [
          "Job Number",
          "Customer Name",
          "Service Date",
          "Job Type",
          "Revenue",
          "Cost",
          "Margin",
          "Margin %",
        ];
        rows = dataArray.map((item) => [
          item.jobNumber,
          item.customerName,
          new Date(item.serviceDate).toISOString().split("T")[0],
          item.jobType,
          item.revenue,
          item.cost,
          item.margin,
          item.marginPercent,
        ]);
        break;

      case "jobs":
        headers = [
          "Job Number",
          "Customer Name",
          "Service Date",
          "Job Type",
          "Status",
          "Revenue",
          "Cost",
          "Margin",
        ];
        rows = dataArray.map((item) => [
          item.jobNumber,
          item.customerName,
          new Date(item.serviceDate).toISOString().split("T")[0],
          item.jobType,
          item.status,
          item.revenue,
          item.cost,
          item.margin,
        ]);
        break;

      case "driver-hours":
        headers = [
          "Driver Name",
          "Total Hours",
          "Total Jobs",
          "Average Hours/Job",
          "Last Job Date",
        ];
        rows = dataArray.map((item) => [
          item.driverName,
          item.totalHours,
          item.totalJobs,
          item.averageHoursPerJob,
          item.lastJobDate
            ? new Date(item.lastJobDate).toISOString().split("T")[0]
            : "",
        ]);
        break;

      case "fatigue":
        headers = [
          "Driver Name",
          "Assessment Date",
          "Total Work (hrs)",
          "Total Rest (hrs)",
          "Fatigue Level",
          "Status",
        ];
        rows = dataArray.map((item) => [
          item.driverName,
          new Date(item.assessmentDate).toISOString().split("T")[0],
          item.totalWork,
          item.totalRest,
          item.fatigueLevel,
          item.status,
        ]);
        break;

      case "open-jobs":
        headers = [
          "Service Date",
          "Open Count",
          "Assigned Count",
          "Ready to Close Count",
          "Total Count",
        ];
        rows = dataArray.map((item) => [
          new Date(item.serviceDate).toISOString().split("T")[0],
          item.openCount,
          item.assignedCount,
          item.readyToCloseCount,
          item.totalCount,
        ]);
        break;

      case "customer-churn":
        headers = [
          "Customer Name",
          "Last Job Date",
          "Total Jobs",
          "Total Revenue",
          "Days Since Last Job",
          "Churn Risk",
        ];
        rows = dataArray.map((item) => [
          item.customerName,
          item.lastJobDate
            ? new Date(item.lastJobDate).toISOString().split("T")[0]
            : "",
          item.totalJobs,
          item.totalRevenue,
          item.daysSinceLastJob,
          item.churnRisk,
        ]);
        break;

      case "banned-entities":
        headers = ["Entity Type", "Name", "Reason", "Banned Date", "Banned By"];
        rows = dataArray.map((item) => [
          item.entityType,
          item.name,
          item.reason || "",
          item.bannedDate
            ? new Date(item.bannedDate).toISOString().split("T")[0]
            : "",
          item.bannedBy || "",
        ]);
        break;
    }

    // Escape CSV values
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Build CSV
    let csv = headers.map(escapeCSV).join(",") + "\r\n";
    rows.forEach((row) => {
      csv += row.map(escapeCSV).join(",") + "\r\n";
    });

    // Add BOM for Excel compatibility
    const buffer = Buffer.from("\ufeff" + csv, "utf-8");

    return {
      buffer: buffer,
      contentType: "text/csv; charset=utf-8",
    };
  }

  /**
   * Generate Excel file
   * @param {string} reportType - Report type
   * @param {Object} data - Report data
   * @returns {Object} Excel buffer and content type
   */
  static async generateExcel(reportType, data) {
    // Note: exceljs library is required for Excel export
    // Install with: npm install exceljs
    try {
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Report");

      // Use same data structure as CSV
      const csvResult = this.generateCSV(reportType, data);
      const csvContent = csvResult.buffer.toString("utf-8").replace(/^\ufeff/, "");
      const lines = csvContent.split("\r\n").filter((line) => line.trim());

      if (lines.length === 0) {
        throw new AppError("No data to export", HttpStatusCodes.BAD_REQUEST);
      }

      // Parse CSV and add to worksheet
      lines.forEach((line, index) => {
        const values = line.split(",").map((val) => {
          // Remove quotes if present
          val = val.trim();
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1).replace(/""/g, '"');
          }
          return val;
        });

        const row = worksheet.addRow(values);

        // Format header row
        if (index === 0) {
          row.font = { bold: true };
          row.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE0E0E0" },
          };
        }
      });

      // Auto-size columns
      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = maxLength < 10 ? 10 : maxLength + 2;
      });

      // Freeze header row
      worksheet.views = [{ state: "frozen", ySplit: 1 }];

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();

      return {
        buffer: buffer,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        throw new AppError(
          "Excel export requires exceljs library. Please install it with: npm install exceljs",
          HttpStatusCodes.NOT_IMPLEMENTED
        );
      }
      throw error;
    }
  }

  /**
   * Generate PDF file
   * @param {string} reportType - Report type
   * @param {Object} data - Report data
   * @param {Object} query - Query parameters (for header info)
   * @returns {Object} PDF buffer and content type
   */
  static async generatePDF(reportType, data, query) {
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    // Collect PDF data
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));

    // Add header
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#000000");
    doc.text(`Report: ${reportType.toUpperCase().replace(/-/g, " ")}`, {
      align: "center",
    });
    if (query.startDate && query.endDate) {
      doc.fontSize(10).font("Helvetica").fillColor("#666666");
      doc.text(`Date Range: ${query.startDate} to ${query.endDate}`, {
        align: "center",
      });
    }
    doc.fontSize(8).text(`Generated: ${new Date().toLocaleString()}`, {
      align: "center",
    });
    doc.moveDown(2);

    // Extract data array
    let dataArray = [];
    if (data.invoices) dataArray = data.invoices;
    else if (data.payRuns) dataArray = data.payRuns;
    else if (data.margins) dataArray = data.margins;
    else if (data.jobs) dataArray = data.jobs;
    else if (data.driverHours) dataArray = data.driverHours;
    else if (data.reports) dataArray = data.reports;
    else if (data.customers) dataArray = data.customers;
    else if (data.entities) dataArray = data.entities;

    if (dataArray.length === 0) {
      doc.fontSize(12).text("No data available", { align: "center" });
      doc.end();
      return new Promise((resolve) => {
        doc.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: "application/pdf",
          });
        });
      });
    }

    // Track data row index for alternating colors
    let dataRowIndex = 0;

    // Helper function to add table row with borders
    const addTableRow = (doc, row, isHeader = false, columnWidths, headersRef, columnAlignments = null) => {
      const startY = doc.y;
      let x = doc.page.margins.left;
      const rowHeight = 20;
      const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);

      // Draw cell borders and background
      row.forEach((cell, index) => {
        const width = columnWidths[index];
        // Draw border
        doc.rect(x, startY, width, rowHeight).stroke();
        // Fill background for header or alternating rows
        if (isHeader) {
          doc.rect(x, startY, width, rowHeight).fill("#E0E0E0");
        } else if (index === 0) {
          // Alternate row colors for data rows
          if (dataRowIndex % 2 === 0) {
            doc.rect(x, startY, totalWidth, rowHeight).fill("#F5F5F5");
          }
        }

        // Draw text
        doc.fontSize(isHeader ? 10 : 9);
        doc.font(isHeader ? "Helvetica-Bold" : "Helvetica");
        doc.fillColor("#000000");

        const text = String(cell || "");
        // Determine alignment: use provided alignment or default to left
        const alignment = columnAlignments && columnAlignments[index] ? columnAlignments[index] : "left";
        
        doc.text(text, x + 5, startY + 5, {
          width: width - 10,
          height: rowHeight - 10,
          align: alignment,
          ellipsis: true,
        });

        x += width;
      });

      doc.y = startY + rowHeight;

      // Increment data row index if not header
      if (!isHeader) {
        dataRowIndex++;
      }

      // Check if we need a new page (with buffer for footer)
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        // Reset data row index on new page (header will be drawn, so next row is index 0)
        dataRowIndex = 0;
        // Redraw header if not first page
        if (!isHeader && headersRef && headersRef.length > 0) {
          addTableRow(doc, headersRef, true, columnWidths, headersRef, columnAlignments);
        }
      }
    };

    // Prepare headers, column widths, and alignments
    let headers = [];
    let columnWidths = [];
    let columnAlignments = [];
    let rows = [];

    switch (reportType) {
      case "invoices":
        headers = [
          "Invoice No",
          "Customer",
          "Issue Date",
          "Due Date",
          "Total",
          "Balance",
          "Status",
        ];
        columnWidths = [100, 120, 80, 80, 80, 80, 80];
        columnAlignments = ["left", "left", "center", "center", "right", "right", "center"];
        rows = dataArray.map((item) => [
          item.invoiceNo,
          item.customerName,
          new Date(item.issueDate).toISOString().split("T")[0],
          new Date(item.dueDate).toISOString().split("T")[0],
          `$${parseFloat(item.totalIncGst).toFixed(2)}`,
          `$${parseFloat(item.balanceDue).toFixed(2)}`,
          item.status,
        ]);
        break;
      case "pay-runs":
        headers = [
          "Label",
          "Period Start",
          "Period End",
          "Drivers",
          "Total Gross",
          "Status",
        ];
        columnWidths = [150, 100, 100, 70, 100, 80];
        columnAlignments = ["left", "center", "center", "right", "right", "center"];
        rows = dataArray.map((item) => [
          item.label,
          new Date(item.periodStart).toISOString().split("T")[0],
          new Date(item.periodEnd).toISOString().split("T")[0],
          item.totaldrivers,
          `$${parseFloat(item.totalGross).toFixed(2)}`,
          item.status,
        ]);
        break;
      case "margins":
        headers = [
          "Job Number",
          "Customer",
          "Service Date",
          "Type",
          "Revenue",
          "Cost",
          "Margin",
          "Margin %",
        ];
        columnWidths = [100, 120, 90, 70, 80, 80, 80, 70];
        columnAlignments = ["left", "left", "center", "center", "right", "right", "right", "right"];
        rows = dataArray.map((item) => [
          item.jobNumber,
          item.customerName,
          new Date(item.serviceDate).toISOString().split("T")[0],
          item.jobType,
          `$${parseFloat(item.revenue).toFixed(2)}`,
          `$${parseFloat(item.cost).toFixed(2)}`,
          `$${parseFloat(item.margin).toFixed(2)}`,
          `${parseFloat(item.marginPercent).toFixed(2)}%`,
        ]);
        break;
      case "jobs":
        headers = [
          "Job Number",
          "Customer",
          "Service Date",
          "Type",
          "Status",
          "Revenue",
          "Cost",
          "Margin",
        ];
        columnWidths = [100, 120, 90, 70, 80, 80, 80, 80];
        columnAlignments = ["left", "left", "center", "center", "center", "right", "right", "right"];
        rows = dataArray.map((item) => [
          item.jobNumber,
          item.customerName,
          new Date(item.serviceDate).toISOString().split("T")[0],
          item.jobType,
          item.status,
          `$${parseFloat(item.revenue).toFixed(2)}`,
          `$${parseFloat(item.cost).toFixed(2)}`,
          `$${parseFloat(item.margin).toFixed(2)}`,
        ]);
        break;
      case "driver-hours":
        headers = [
          "Driver Name",
          "Total Hours",
          "Total Jobs",
          "Avg Hours/Job",
          "Last Job Date",
        ];
        columnWidths = [150, 100, 90, 110, 100];
        columnAlignments = ["left", "right", "right", "right", "center"];
        rows = dataArray.map((item) => [
          item.driverName,
          parseFloat(item.totalHours).toFixed(2),
          item.totalJobs,
          parseFloat(item.averageHoursPerJob).toFixed(2),
          item.lastJobDate
            ? new Date(item.lastJobDate).toISOString().split("T")[0]
            : "N/A",
        ]);
        break;
      case "fatigue":
        headers = [
          "Driver Name",
          "Assessment Date",
          "Work (hrs)",
          "Rest (hrs)",
          "Fatigue Level",
          "Status",
        ];
        columnWidths = [150, 110, 80, 80, 100, 80];
        columnAlignments = ["left", "center", "right", "right", "center", "center"];
        rows = dataArray.map((item) => [
          item.driverName,
          new Date(item.assessmentDate).toISOString().split("T")[0],
          parseFloat(item.totalWork).toFixed(2),
          parseFloat(item.totalRest).toFixed(2),
          item.fatigueLevel,
          item.status,
        ]);
        break;
      case "open-jobs":
        headers = [
          "Service Date",
          "Open",
          "Assigned",
          "Ready to Close",
          "Total",
        ];
        columnWidths = [120, 80, 90, 120, 80];
        columnAlignments = ["center", "right", "right", "right", "right"];
        rows = dataArray.map((item) => [
          new Date(item.serviceDate).toISOString().split("T")[0],
          item.openCount,
          item.assignedCount,
          item.readyToCloseCount,
          item.totalCount,
        ]);
        break;
      case "customer-churn":
        headers = [
          "Customer Name",
          "Last Job Date",
          "Total Jobs",
          "Total Revenue",
          "Days Since",
          "Churn Risk",
        ];
        columnWidths = [150, 100, 90, 100, 90, 90];
        columnAlignments = ["left", "center", "right", "right", "right", "center"];
        rows = dataArray.map((item) => [
          item.customerName,
          item.lastJobDate
            ? new Date(item.lastJobDate).toISOString().split("T")[0]
            : "",
          item.totalJobs,
          `$${parseFloat(item.totalRevenue).toFixed(2)}`,
          item.daysSinceLastJob,
          item.churnRisk,
        ]);
        break;
      case "banned-entities":
        headers = ["Entity Type", "Name", "Reason", "Banned Date", "Banned By"];
        columnWidths = [100, 150, 150, 100, 120];
        columnAlignments = ["center", "left", "left", "center", "left"];
        rows = dataArray.map((item) => [
          item.entityType,
          item.name,
          item.reason || "",
          item.bannedDate
            ? new Date(item.bannedDate).toISOString().split("T")[0]
            : "",
          item.bannedBy || "",
        ]);
        break;
    }

    // Add table header
    if (headers.length > 0 && rows.length > 0) {
      addTableRow(doc, headers, true, columnWidths, headers, columnAlignments);
    }

    // Add data rows
    if (rows.length > 0) {
      rows.forEach((row) => {
        addTableRow(doc, row, false, columnWidths, headers, columnAlignments);
      });
    } else {
      // No data message
      doc.fontSize(12).font("Helvetica").fillColor("#666666");
      doc.text("No data available for the selected filters.", {
        align: "center",
      });
    }

    // Add summary for margins report
    if (reportType === "margins" && rows.length > 0) {
      doc.moveDown(1);
      doc.fontSize(10).font("Helvetica-Bold");
      const totalRevenue = rows.reduce((sum, row) => {
        const revenue = parseFloat(row[4].replace("$", "")) || 0;
        return sum + revenue;
      }, 0);
      const totalCost = rows.reduce((sum, row) => {
        const cost = parseFloat(row[5].replace("$", "")) || 0;
        return sum + cost;
      }, 0);
      const totalMargin = totalRevenue - totalCost;
      doc.text(`Total Revenue: $${totalRevenue.toFixed(2)}`, { align: "right" });
      doc.text(`Total Cost: $${totalCost.toFixed(2)}`, { align: "right" });
      doc.text(`Total Margin: $${totalMargin.toFixed(2)}`, { align: "right" });
    }

    // Add footer only if we have pages
    const totalPages = doc.bufferedPageRange().count;
    if (totalPages > 0) {
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .text(
            `Page ${i + 1} of ${totalPages}`,
            50,
            doc.page.height - 30,
            { align: "center", width: 500 }
          );
      }
    }

    doc.end();

    // Wait for PDF to finish
    return new Promise((resolve) => {
      doc.on("end", () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: "application/pdf",
        });
      });
    });
  }
}

module.exports = ReportService;

