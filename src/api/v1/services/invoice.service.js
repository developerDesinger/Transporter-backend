const Invoice = require("../models/invoice.model");
const InvoiceLineItem = require("../models/invoiceLineItem.model");
const Job = require("../models/job.model");
const AllocatorRow = require("../models/allocatorRow.model");
const Customer = require("../models/customer.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const mongoose = require("mongoose");

class InvoiceService {
  /**
   * Build invoices from completed jobs within a date range
   * @param {Object} data - Request data (from, to, grouping)
   * @param {Object} user - Authenticated user
   * @returns {Object} Created invoices and count
   */
  static async buildInvoices(data, user) {
    const errors = [];

    // Validation
    if (!data.from) {
      errors.push({ field: "from", message: "from date is required" });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.from)) {
      errors.push({
        field: "from",
        message: "from date must be in YYYY-MM-DD format",
      });
    }

    if (!data.to) {
      errors.push({ field: "to", message: "to date is required" });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.to)) {
      errors.push({
        field: "to",
        message: "to date must be in YYYY-MM-DD format",
      });
    }

    if (data.grouping && !["DAY", "WEEK", "PO"].includes(data.grouping)) {
      errors.push({
        field: "grouping",
        message: "grouping must be DAY, WEEK, or PO",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Parse dates
    const fromDate = new Date(data.from + "T00:00:00");
    const toDate = new Date(data.to + "T23:59:59");

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new AppError("Invalid date format", HttpStatusCodes.BAD_REQUEST);
    }

    if (fromDate > toDate) {
      throw new AppError(
        "from date must be before or equal to to date",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const organizationId = user.activeOrganizationId || null;

    // Fetch completed jobs (CLOSED status)
    // Note: We'll query both Job model (for locked rows) and AllocatorRow model (for completed rows)
    // For now, we'll focus on Job model with CLOSED status
    const completedJobs = await Job.find({
      date: {
        $gte: data.from,
        $lte: data.to,
      },
      status: "CLOSED",
      customerId: { $exists: true, $ne: null },
      organizationId: organizationId,
    })
      .populate("customerId")
      .lean();

    if (completedJobs.length === 0) {
      return {
        success: true,
        created: 0,
        invoices: [],
        message: "No completed jobs found in the specified date range",
      };
    }

    // Group jobs by customer and grouping method
    const groupedJobs = this.groupJobs(completedJobs, data.grouping);

    const createdInvoices = [];
    const currentYear = new Date().getFullYear();

    // Create invoices for each group
    for (const [groupKey, jobs] of Object.entries(groupedJobs)) {
      if (jobs.length === 0) continue;

      const customer = jobs[0].customerId;
      if (!customer) continue;

      const groupMethod = data.grouping || customer.invoiceGrouping || "DAY";

      // Check for existing invoice
      const existingInvoice = await this.checkExistingInvoice(
        customer._id,
        groupKey,
        groupMethod,
        fromDate,
        toDate,
        organizationId
      );

      if (existingInvoice) {
        continue; // Skip if invoice already exists
      }

      // Generate invoice number
      const invoiceNo = await this.generateInvoiceNumber(customer, currentYear);

      // Calculate totals
      let totalExGst = 0;
      for (const job of jobs) {
        totalExGst += parseFloat(job.customerCharge || 0);
      }

      const gst = totalExGst * 0.1; // 10% GST
      const totalIncGst = totalExGst + gst;

      // Set dates
      const issueDate = new Date(toDate);
      const paymentTerms = customer.termsDays || 14;
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + paymentTerms);

      // Extract purchase order if PO grouping
      let purchaseOrderNumber = null;
      if (groupMethod === "PO") {
        // For PO grouping, extract from groupKey (format: customerId-PO)
        const parts = groupKey.split("-");
        if (parts.length > 1) {
          // Rejoin all parts after customerId to handle PO numbers with dashes
          purchaseOrderNumber = parts.slice(1).join("-");
        }
      }

      // Create invoice
      const invoice = await Invoice.create({
        invoiceNo,
        customerId: customer._id,
        issueDate,
        dueDate,
        status: "DRAFT",
        totalExGst,
        gst,
        totalIncGst,
        balanceDue: totalIncGst,
        grouping: groupMethod,
        purchaseOrderNumber,
        organizationId,
      });

      // Create line items
      for (const job of jobs) {
        await InvoiceLineItem.create({
          invoiceId: invoice._id,
          jobId: job._id,
          allocatorRowId: job.allocatorRowId || null,
          date: job.date,
          jobNumber: job.jobNumber || `JOB-${job._id}`,
          description: job.notes || job.routeDescription || "Delivery service",
          quantity: 1,
          unitPrice: parseFloat(job.customerCharge || 0),
          total: parseFloat(job.customerCharge || 0),
        });
      }

      // Populate customer for response
      await invoice.populate("customerId");
      await invoice.populate({
        path: "customerId",
        populate: {
          path: "party",
          select: "companyName",
        },
      });

      // Get line items for response
      const lineItems = await InvoiceLineItem.find({ invoiceId: invoice._id }).lean();

      createdInvoices.push({
        id: invoice._id.toString(),
        invoiceNo: invoice.invoiceNo,
        customerId: invoice.customerId._id.toString(),
        customer: {
          id: invoice.customerId._id.toString(),
          party: invoice.customerId.party
            ? {
                companyName: invoice.customerId.party.companyName || null,
              }
            : null,
        },
        issueDate: invoice.issueDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        status: invoice.status,
        totalExGst: invoice.totalExGst,
        gst: invoice.gst,
        totalIncGst: invoice.totalIncGst,
        balanceDue: invoice.balanceDue,
        lineItems: lineItems.map((item) => ({
          id: item._id.toString(),
          date: item.date,
          jobNumber: item.jobNumber,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
        createdAt: invoice.createdAt.toISOString(),
      });
    }

    return {
      success: true,
      created: createdInvoices.length,
      invoices: createdInvoices,
      message: `Created ${createdInvoices.length} invoice(s) successfully`,
    };
  }

  /**
   * Group jobs by customer and grouping method
   * @param {Array} jobs - Array of job objects
   * @param {string} groupingOverride - Optional grouping override
   * @returns {Object} Grouped jobs by group key
   */
  static groupJobs(jobs, groupingOverride) {
    const groups = {};

    for (const job of jobs) {
      const customer = job.customerId;
      if (!customer) continue;

      const groupMethod = groupingOverride || customer.invoiceGrouping || "DAY";

      let groupKey;

      if (groupMethod === "DAY") {
        // Group by customer + date
        const dateStr = job.date;
        groupKey = `${customer._id.toString()}-${dateStr}`;
      } else if (groupMethod === "WEEK") {
        // Group by customer + week
        const week = this.getWeekNumber(new Date(job.date + "T00:00:00"));
        const year = new Date(job.date + "T00:00:00").getFullYear();
        groupKey = `${customer._id.toString()}-${year}-W${week}`;
      } else if (groupMethod === "PO") {
        // Group by customer + purchase order
        // Note: Job model doesn't have purchaseOrderNumber field, so we use jobNumber as fallback
        // In a real implementation, you might extract PO from job notes or add a PO field to Job model
        const po = job.jobNumber || `JOB-${job._id}` || "NO-PO";
        groupKey = `${customer._id.toString()}-${po}`;
      } else {
        // Default to DAY for MONTH or unknown grouping
        const dateStr = job.date;
        groupKey = `${customer._id.toString()}-${dateStr}`;
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(job);
    }

    return groups;
  }

  /**
   * Get ISO week number
   * @param {Date} date - Date object
   * @returns {number} Week number
   */
  static getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  /**
   * Check if invoice already exists for this group
   * @param {string} customerId - Customer ID
   * @param {string} groupKey - Group key
   * @param {string} grouping - Grouping method
   * @param {Date} fromDate - Start date
   * @param {Date} toDate - End date
   * @param {string} organizationId - Organization ID
   * @returns {Object|null} Existing invoice or null
   */
  static async checkExistingInvoice(customerId, groupKey, grouping, fromDate, toDate, organizationId) {
    // Check for existing invoice with same customer, grouping, and date range
    const existing = await Invoice.findOne({
      customerId: new mongoose.Types.ObjectId(customerId),
      grouping,
      issueDate: { $gte: fromDate, $lte: toDate },
      status: { $ne: "VOID" },
      organizationId: organizationId,
    });

    return existing;
  }

  /**
   * Generate invoice number
   * @param {Object} customer - Customer object
   * @param {number} year - Year
   * @returns {string} Invoice number
   */
  static async generateInvoiceNumber(customer, year) {
    const prefix = customer.invoicePrefix || "INV";
    const pattern = new RegExp(`^${prefix}-${year}-`);

    const lastInvoice = await Invoice.findOne({
      customerId: customer._id,
      invoiceNo: pattern,
    }).sort({ invoiceNo: -1 });

    let sequence = 1;
    if (lastInvoice) {
      const parts = lastInvoice.invoiceNo.split("-");
      if (parts.length >= 3) {
        const lastSequence = parseInt(parts[2]);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      }
    }

    return `${prefix}-${year}-${String(sequence).padStart(3, "0")}`;
  }

  /**
   * Get all invoices with optional filtering
   * @param {Object} query - Query parameters (status, customerId, from, to, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Paginated invoices
   */
  static async getAllInvoices(query, user) {
    const InvoiceLineItem = require("../models/invoiceLineItem.model");
    const filter = {};

    // Multi-tenant support
    if (user.activeOrganizationId) {
      filter.organizationId = user.activeOrganizationId;
    } else {
      filter.organizationId = null;
    }

    // Filter by status
    if (query.status) {
      if (!["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"].includes(query.status)) {
        throw new AppError(
          "Invalid status. Must be DRAFT, SENT, PAID, OVERDUE, or VOID",
          HttpStatusCodes.BAD_REQUEST
        );
      }
      filter.status = query.status;
    }

    // Filter by customerId
    if (query.customerId) {
      if (!mongoose.Types.ObjectId.isValid(query.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }
      filter.customerId = new mongoose.Types.ObjectId(query.customerId);
    }

    // Filter by date range
    if (query.from || query.to) {
      filter.issueDate = {};
      if (query.from) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from)) {
          throw new AppError(
            "from date must be in YYYY-MM-DD format",
            HttpStatusCodes.BAD_REQUEST
          );
        }
        filter.issueDate.$gte = new Date(query.from + "T00:00:00");
      }
      if (query.to) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
          throw new AppError(
            "to date must be in YYYY-MM-DD format",
            HttpStatusCodes.BAD_REQUEST
          );
        }
        filter.issueDate.$lte = new Date(query.to + "T23:59:59");
      }
    }

    // Pagination
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    // Fetch invoices
    const invoices = await Invoice.find(filter)
      .populate("customerId", "partyId")
      .populate({
        path: "customerId",
        populate: {
          path: "party",
          select: "companyName",
        },
      })
      .sort({ issueDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const total = await Invoice.countDocuments(filter);

    // Get line items for each invoice
    const invoicesWithLineItems = await Promise.all(
      invoices.map(async (invoice) => {
        const lineItems = await InvoiceLineItem.find({
          invoiceId: invoice._id,
        }).lean();

        return {
          id: invoice._id.toString(),
          invoiceNo: invoice.invoiceNo,
          customerId: invoice.customerId ? invoice.customerId._id.toString() : null,
          customer: invoice.customerId
            ? {
                id: invoice.customerId._id.toString(),
                party: invoice.customerId.party
                  ? {
                      companyName: invoice.customerId.party.companyName || null,
                    }
                  : null,
              }
            : null,
          issueDate: invoice.issueDate.toISOString(),
          dueDate: invoice.dueDate.toISOString(),
          status: invoice.status,
          totalExGst: invoice.totalExGst,
          gst: invoice.gst,
          totalIncGst: invoice.totalIncGst,
          balanceDue: invoice.balanceDue,
          grouping: invoice.grouping,
          purchaseOrderNumber: invoice.purchaseOrderNumber,
          lineItems: lineItems.map((item) => ({
            id: item._id.toString(),
            date: item.date,
            jobNumber: item.jobNumber,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
          createdAt: invoice.createdAt.toISOString(),
          updatedAt: invoice.updatedAt.toISOString(),
        };
      })
    );

    return {
      success: true,
      data: invoicesWithLineItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = InvoiceService;

