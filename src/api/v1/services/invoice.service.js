const Invoice = require("../models/invoice.model");
const InvoiceLineItem = require("../models/invoiceLineItem.model");
const Job = require("../models/job.model");
const AllocatorRow = require("../models/allocatorRow.model");
const Customer = require("../models/customer.model");
const InvoiceDeliveryEvent = require("../models/invoiceDeliveryEvent.model");
const InvoiceDeliveryEventLog = require("../models/invoiceDeliveryEventLog.model");
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
      if (!["DRAFT", "PENDING", "SENT", "PAID", "OVERDUE", "VOID"].includes(query.status)) {
        throw new AppError(
          "Invalid status. Must be DRAFT, PENDING, SENT, PAID, OVERDUE, or VOID",
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

  /**
   * Get receivables invoices with optional status filter
   * @param {Object} query - Query parameters (status)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of invoice objects with calculated balance and status
   */
  static async getReceivablesInvoices(query, user) {
    const organizationId = user.activeOrganizationId || null;

    // Build filter
    const filter = {};

    // Multi-tenancy
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    // Filter by status if provided
    if (query.status && query.status !== "all") {
      const validStatuses = ["DRAFT", "PENDING", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"];
      if (validStatuses.includes(query.status)) {
        filter.status = query.status;
      } else {
        // Invalid status, exclude voided by default
        filter.status = { $ne: "VOID" };
      }
    } else {
      // Exclude voided invoices by default
      filter.status = { $ne: "VOID" };
    }

    // Fetch invoices with customer populated
    const invoices = await Invoice.find(filter)
      .populate({
        path: "customerId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ dueDate: 1 }) // Sort by due date ascending (oldest first)
      .lean();

    // Process each invoice to calculate balance and determine status
    const invoicesWithBalance = await Promise.all(
      invoices.map(async (invoice) => {
        // Get customer name from party
        let customerName = "Unknown";
        if (invoice.customerId && invoice.customerId.partyId) {
          const party = invoice.customerId.partyId;
          if (party.companyName) {
            customerName = party.companyName;
          } else if (party.firstName || party.lastName) {
            customerName = `${party.firstName || ""} ${party.lastName || ""}`.trim();
          }
        }

        // Calculate balance due from payments
        const InvoicePayment = require("../models/invoicePayment.model");
        const total = parseFloat(invoice.totalIncGst || 0);
        
        // Calculate total payments
        const payments = await InvoicePayment.find({
          invoiceId: invoice._id,
        }).lean();
        
        const totalPayments = payments.reduce(
          (sum, payment) => sum + parseFloat(payment.amount || 0),
          0
        );
        
        // Calculate paid this month (current month)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);
        
        const paidThisMonth = payments
          .filter((payment) => {
            const receiptDate = new Date(payment.receiptDate);
            return receiptDate >= startOfMonth && receiptDate <= endOfMonth;
          })
          .reduce((sum, payment) => sum + parseFloat(payment.amount || 0), 0);
        
        // TODO: When InvoiceShortpay model is added, subtract short pays here
        const totalShortPays = 0;
        
        // Calculate balance due
        let balanceDue = total - totalPayments - totalShortPays;
        
        // Ensure balance due is not negative
        if (balanceDue < 0) {
          balanceDue = 0;
        }

        // Fetch invoice line items
        const lineItems = await InvoiceLineItem.find({
          invoiceId: invoice._id,
        }).lean();

        // TODO: When InvoiceShortpay model is added, fetch short pays here
        const shortpays = [];

        // Determine status based on balanceDue and dueDate
        let calculatedStatus = invoice.status;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = new Date(invoice.dueDate);
        dueDate.setHours(0, 0, 0, 0);

        if (balanceDue === 0) {
          calculatedStatus = "PAID";
        } else if (balanceDue < total && balanceDue > 0) {
          calculatedStatus = "PARTIAL";
        } else if (dueDate < today && balanceDue > 0) {
          calculatedStatus = "OVERDUE";
        } else if (invoice.status === "DRAFT" || invoice.status === "PENDING") {
          calculatedStatus = invoice.status; // Keep DRAFT or PENDING as is
        } else {
          calculatedStatus = "SENT";
        }

        // Format response
        return {
          id: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNo,
          customerId: invoice.customerId
            ? invoice.customerId._id.toString()
            : null,
          customer: {
            id: invoice.customerId
              ? invoice.customerId._id.toString()
              : null,
            name: customerName,
          },
          issueDate: invoice.issueDate.toISOString(),
          dueDate: invoice.dueDate.toISOString(),
          total: total.toFixed(2),
          balanceDue: balanceDue.toFixed(2),
          paidThisMonth: paidThisMonth.toFixed(2),
          status: calculatedStatus,
          lines: lineItems.map((line) => ({
            description: line.description,
            quantity: parseFloat(line.quantity || 0).toFixed(2),
            unitPrice: parseFloat(line.unitPrice || 0).toFixed(2),
            lineTotal: parseFloat(line.total || 0).toFixed(2),
          })),
          shortpays: shortpays.map((sp) => ({
            amount: parseFloat(sp.amount || 0).toFixed(2),
            reason: sp.reason || null,
            memo: sp.memo || null,
          })),
        };
      })
    );

    return invoicesWithBalance;
  }

  /**
   * Generate unique invoice number for receivables invoices
   * @param {string} organizationId - Organization ID
   * @returns {string} Invoice number
   */
  static async generateReceivablesInvoiceNumber(organizationId) {
    const year = new Date().getFullYear();
    const prefix = "INV";
    const pattern = new RegExp(`^${prefix}-${year}-`);

    // Find last invoice for this organization in current year
    const lastInvoice = await Invoice.findOne({
      organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
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

    // Ensure uniqueness (retry if exists, max 10 attempts)
    let attempts = 0;
    let invoiceNumber;
    let exists = true;

    while (exists && attempts < 10) {
      // Format with zero padding (e.g., 001, 002)
      invoiceNumber = `${prefix}-${year}-${String(sequence).padStart(3, "0")}`;

      // Check if invoice number exists
      const existingInvoice = await Invoice.findOne({
        invoiceNo: invoiceNumber,
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
      });

      if (!existingInvoice) {
        exists = false;
      } else {
        sequence++;
        attempts++;
      }
    }

    if (exists) {
      throw new AppError(
        "Unable to generate unique invoice number",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    return invoiceNumber;
  }

  /**
   * Create a new receivables invoice
   * @param {Object} data - Request data (customerId, issueDate, dueDate, lines, total, status)
   * @param {Object} user - Authenticated user
   * @returns {Object} Created invoice with all fields
   */
  static async createReceivablesInvoice(data, user) {
    const InvoiceLineItem = require("../models/invoiceLineItem.model");
    const Customer = require("../models/customer.model");
    const mongoose = require("mongoose");

    const errors = [];

    // Validation
    if (!data.customerId) {
      errors.push({
        field: "customerId",
        message: "Customer is required",
      });
    }

    if (!data.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.issueDate)) {
      errors.push({
        field: "issueDate",
        message: "Issue date is required and must be in YYYY-MM-DD format",
      });
    }

    if (!data.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) {
      errors.push({
        field: "dueDate",
        message: "Due date is required and must be in YYYY-MM-DD format",
      });
    }

    // Validate date relationship
    if (data.issueDate && data.dueDate) {
      const issueDateObj = new Date(data.issueDate + "T00:00:00");
      const dueDateObj = new Date(data.dueDate + "T00:00:00");
      if (dueDateObj < issueDateObj) {
        errors.push({
          field: "dueDate",
          message: "Due date must be on or after issue date",
        });
      }
    }

    if (!data.lines || !Array.isArray(data.lines) || data.lines.length === 0) {
      errors.push({
        field: "lines",
        message: "At least one line item is required",
      });
    }

    // Validate line items
    if (data.lines && Array.isArray(data.lines)) {
      data.lines.forEach((line, index) => {
        if (!line.description || line.description.trim() === "") {
          errors.push({
            field: `lines[${index}].description`,
            message: "Description is required",
          });
        }

        if (!line.quantity || parseFloat(line.quantity) <= 0) {
          errors.push({
            field: `lines[${index}].quantity`,
            message: "Quantity must be greater than 0",
          });
        }

        if (
          line.unitPrice === undefined ||
          line.unitPrice === null ||
          parseFloat(line.unitPrice) < 0
        ) {
          errors.push({
            field: `lines[${index}].unitPrice`,
            message: "Unit price must be 0 or greater",
          });
        }

        const calculatedTotal = parseFloat(line.quantity || 0) * parseFloat(line.unitPrice || 0);
        if (Math.abs(calculatedTotal - parseFloat(line.lineTotal || 0)) > 0.01) {
          errors.push({
            field: `lines[${index}].lineTotal`,
            message: "Line total must equal quantity * unit price",
          });
        }
      });
    }

    // Validate total
    if (data.lines && Array.isArray(data.lines)) {
      const calculatedTotal = data.lines.reduce(
        (sum, line) => sum + parseFloat(line.lineTotal || 0),
        0
      );
      if (Math.abs(calculatedTotal - parseFloat(data.total || 0)) > 0.01) {
        errors.push({
          field: "total",
          message: "Total must equal sum of all line totals",
        });
      }
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    const organizationId = user.activeOrganizationId || null;
    const userId = user.id || user._id;

    // Start transaction
    const session = await mongoose.startSession();
    let transactionStarted = false;

    try {
      session.startTransaction();
      transactionStarted = true;

      // Verify customer exists and belongs to organization
      const customerFilter = {
        _id: new mongoose.Types.ObjectId(data.customerId),
      };

      if (organizationId) {
        customerFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
      } else {
        customerFilter.organizationId = null;
      }

      const customer = await Customer.findOne(customerFilter)
        .populate({
          path: "partyId",
          select: "companyName firstName lastName",
        })
        .session(session)
        .lean();

      if (!customer) {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
      }

      // Generate invoice number
      const invoiceNumber = await this.generateReceivablesInvoiceNumber(organizationId);

      // Parse dates
      const issueDateObj = new Date(data.issueDate + "T00:00:00");
      const dueDateObj = new Date(data.dueDate + "T00:00:00");
      const total = parseFloat(data.total || 0);
      const status = data.status || "DRAFT";

      // Create invoice
      const invoice = await Invoice.create(
        [
          {
            invoiceNo: invoiceNumber,
            customerId: new mongoose.Types.ObjectId(data.customerId),
            issueDate: issueDateObj,
            dueDate: dueDateObj,
            totalExGst: total, // For receivables, we'll use total as totalExGst
            gst: 0, // No GST for receivables invoices (or calculate if needed)
            totalIncGst: total,
            balanceDue: total,
            status: status,
            grouping: "DAY", // Default grouping for receivables invoices
            organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
          },
        ],
        { session }
      );

      const createdInvoice = invoice[0];

      // Create invoice line items
      const invoiceLines = await InvoiceLineItem.insertMany(
        data.lines.map((line) => ({
          invoiceId: createdInvoice._id,
          description: line.description.trim(),
          quantity: parseFloat(line.quantity),
          unitPrice: parseFloat(line.unitPrice),
          total: parseFloat(line.lineTotal),
          date: data.issueDate, // Use issue date as line item date
        })),
        { session }
      );

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      // Get customer name from party
      let customerName = "Unknown";
      if (customer.partyId) {
        const party = customer.partyId;
        if (party.companyName) {
          customerName = party.companyName;
        } else if (party.firstName || party.lastName) {
          customerName = `${party.firstName || ""} ${party.lastName || ""}`.trim();
        }
      }

      // Format response
      return {
        success: true,
        data: {
          id: createdInvoice._id.toString(),
          invoiceNumber: createdInvoice.invoiceNo,
          customerId: createdInvoice.customerId.toString(),
          customer: {
            id: createdInvoice.customerId.toString(),
            name: customerName,
          },
          issueDate: createdInvoice.issueDate.toISOString(),
          dueDate: createdInvoice.dueDate.toISOString(),
          total: total.toFixed(2),
          balanceDue: total.toFixed(2),
          status: createdInvoice.status,
          lines: invoiceLines.map((line) => ({
            id: line._id.toString(),
            description: line.description,
            quantity: parseFloat(line.quantity || 0).toFixed(2),
            unitPrice: parseFloat(line.unitPrice || 0).toFixed(2),
            lineTotal: parseFloat(line.total || 0).toFixed(2),
          })),
          createdAt: createdInvoice.createdAt.toISOString(),
        },
      };
    } catch (error) {
      // Only abort if transaction was started
      if (transactionStarted) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.warn("Transaction already aborted:", abortError.message);
        }
      }
      try {
        await session.endSession();
      } catch (endError) {
        console.warn("Session already ended:", endError.message);
      }
      throw error;
    }
  }

  /**
   * Quick pay an invoice (record a payment)
   * @param {string} invoiceId - Invoice ID
   * @param {Object} data - Request data (amount, method, reference, receiptDate)
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated invoice with payment record
   */
  static async quickPayInvoice(invoiceId, data, user) {
    const InvoicePayment = require("../models/invoicePayment.model");
    const mongoose = require("mongoose");

    const errors = [];

    // Validate invoice ID
    if (!invoiceId) {
      throw new AppError("Invoice ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID format", HttpStatusCodes.BAD_REQUEST);
    }

    // Validation
    if (!data.amount || parseFloat(data.amount) <= 0) {
      errors.push({
        field: "amount",
        message: "Amount is required and must be greater than 0",
      });
    }

    const PAYMENT_METHODS = ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "BPAY", "OTHER"];
    if (!data.method || !PAYMENT_METHODS.includes(data.method)) {
      errors.push({
        field: "method",
        message: `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`,
      });
    }

    if (!data.receiptDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.receiptDate)) {
      errors.push({
        field: "receiptDate",
        message: "Receipt date is required and must be in YYYY-MM-DD format",
      });
    }

    if (data.reference && typeof data.reference !== "string") {
      errors.push({
        field: "reference",
        message: "Reference must be a string",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    const organizationId = user.activeOrganizationId || null;
    const userId = user.id || user._id;

    // Start transaction
    const session = await mongoose.startSession();
    let transactionStarted = false;

    try {
      session.startTransaction();
      transactionStarted = true;

      // Verify invoice exists
      // Note: We'll extract organizationId from the invoice to ensure payment belongs to same organization
      const invoice = await Invoice.findOne({
        _id: new mongoose.Types.ObjectId(invoiceId),
      }).session(session);

      if (!invoice) {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError("Invoice not found", HttpStatusCodes.NOT_FOUND);
      }

      // Verify invoice belongs to user's organization (authorization check)
      // Only check if both invoice and user have organizationId
      if (invoice.organizationId && organizationId) {
        const invoiceOrgId = invoice.organizationId.toString();
        const userOrgId = organizationId.toString();
        if (invoiceOrgId !== userOrgId) {
          await session.abortTransaction();
          await session.endSession();
          throw new AppError("Invoice not found", HttpStatusCodes.NOT_FOUND);
        }
      }

      // Extract organizationId for payment (optional - can be null)
      // Use invoice's organizationId if available, otherwise use user's activeOrganizationId, or null
      const paymentOrganizationId = invoice.organizationId || organizationId || null;

      // Validate invoice status
      if (invoice.status === "VOID") {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError(
          "Cannot record payment for a voided invoice",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Validate payment amount
      const paymentAmount = parseFloat(data.amount);
      const currentBalanceDue = parseFloat(invoice.balanceDue || 0);
      const invoiceTotal = parseFloat(invoice.totalIncGst || 0);

      if (paymentAmount > currentBalanceDue) {
        await session.abortTransaction();
        await session.endSession();
        throw new AppError(
          "Payment amount exceeds balance due",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Create payment record
      // organizationId is optional - can be null if not available
      const payment = await InvoicePayment.create(
        [
          {
            invoiceId: new mongoose.Types.ObjectId(invoiceId),
            amount: paymentAmount,
            method: data.method,
            reference: data.reference || null,
            receiptDate: new Date(data.receiptDate + "T00:00:00"),
            organizationId: paymentOrganizationId
              ? new mongoose.Types.ObjectId(paymentOrganizationId)
              : null, // Optional - can be null
            createdBy: new mongoose.Types.ObjectId(userId), // REQUIRED - must be provided
          },
        ],
        { session }
      );

      const createdPayment = payment[0];

      // Calculate new balance due
      const newBalanceDue = currentBalanceDue - paymentAmount;

      // Determine new status
      let newStatus = invoice.status;
      if (newBalanceDue === 0) {
        // Fully paid
        newStatus = "PAID";
      } else if (newBalanceDue < invoiceTotal && newBalanceDue > 0) {
        // Partially paid
        newStatus = "PARTIAL";
      } else if ((invoice.status === "DRAFT" || invoice.status === "PENDING") && newBalanceDue === invoiceTotal) {
        // No payment applied (edge case), keep current status (DRAFT or PENDING)
        newStatus = invoice.status;
      }
      // Otherwise, keep current status

      // Update invoice
      invoice.balanceDue = newBalanceDue;
      invoice.status = newStatus;
      await invoice.save({ session });

      // Commit transaction
      await session.commitTransaction();
      await session.endSession();

      // Format response
      return {
        success: true,
        data: {
          id: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNo,
          balanceDue: newBalanceDue.toFixed(2),
          status: newStatus,
          payment: {
            id: createdPayment._id.toString(),
            amount: paymentAmount.toFixed(2),
            method: data.method,
            reference: data.reference || null,
            receiptDate: createdPayment.receiptDate.toISOString(),
            createdAt: createdPayment.createdAt.toISOString(),
          },
          message: "Payment recorded successfully",
        },
      };
    } catch (error) {
      // Only abort if transaction was started
      if (transactionStarted) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.warn("Transaction already aborted:", abortError.message);
        }
      }
      try {
        await session.endSession();
      } catch (endError) {
        console.warn("Session already ended:", endError.message);
      }
      throw error;
    }
  }

  /**
   * Get receivables payments within a date range
   * @param {Object} query - Query parameters (from, to, invoiceId, method, page, limit)
   * @param {Object} user - Authenticated user
   * @returns {Object} Paginated payments with invoice and customer information
   */
  static async getReceivablesPayments(query, user) {
    const InvoicePayment = require("../models/invoicePayment.model");
    const Invoice = require("../models/invoice.model");
    const Customer = require("../models/customer.model");
    const Party = require("../models/party.model");
    const mongoose = require("mongoose");

    const errors = [];
    const PAYMENT_METHODS = [
      "BANK_TRANSFER",
      "CARD",
      "CASH",
      "CHEQUE",
      "BPAY",
      "OTHER",
    ];

    // Validation
    if (!query.from || !/^\d{4}-\d{2}-\d{2}$/.test(query.from)) {
      errors.push({
        field: "from",
        message: "From date is required and must be in YYYY-MM-DD format",
      });
    }

    if (!query.to || !/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
      errors.push({
        field: "to",
        message: "To date is required and must be in YYYY-MM-DD format",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Parse and validate date range
    const fromDate = new Date(query.from + "T00:00:00.000Z");
    const toDate = new Date(query.to + "T23:59:59.999Z");

    if (toDate < fromDate) {
      throw new AppError(
        "To date must be after or equal to from date",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate optional parameters
    if (query.method && !PAYMENT_METHODS.includes(query.method)) {
      errors.push({
        field: "method",
        message: `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`,
      });
    }

    if (query.invoiceId && !mongoose.Types.ObjectId.isValid(query.invoiceId)) {
      errors.push({
        field: "invoiceId",
        message: "Invalid invoice ID format",
      });
    }

    const pageNum = parseInt(query.page) || 1;
    const limitNum = Math.min(parseInt(query.limit) || 50, 100);

    if (pageNum < 1) {
      errors.push({
        field: "page",
        message: "Page must be a positive integer",
      });
    }

    if (limitNum < 1 || limitNum > 100) {
      errors.push({
        field: "limit",
        message: "Limit must be between 1 and 100",
      });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    const organizationId = user.activeOrganizationId || null;
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const filter = {
      receiptDate: {
        $gte: fromDate,
        $lte: toDate,
      },
    };

    // Multi-tenancy: Filter by organizationId if available
    // Since organizationId is optional, we need to handle both cases
    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      // If user doesn't have organizationId, only show payments without organizationId
      filter.organizationId = null;
    }

    // Filter by invoiceId if provided
    if (query.invoiceId) {
      filter.invoiceId = new mongoose.Types.ObjectId(query.invoiceId);
    }

    // Filter by method if provided
    if (query.method) {
      filter.method = query.method;
    }

    // Fetch payments with invoice population
    const payments = await InvoicePayment.find(filter)
      .populate({
        path: "invoiceId",
        select: "invoiceNo customerId",
        populate: {
          path: "customerId",
          select: "partyId",
          populate: {
            path: "partyId",
            select: "companyName firstName lastName",
          },
        },
      })
      .sort({ receiptDate: -1 }) // Most recent first
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Count total
    const total = await InvoicePayment.countDocuments(filter);

    // Format response
    const formattedPayments = payments.map((payment) => {
      const invoice = payment.invoiceId;
      const customer = invoice?.customerId;
      const party = customer?.partyId;

      // Get customer name from party
      let customerName = "Unknown";
      if (party) {
        if (party.companyName) {
          customerName = party.companyName;
        } else if (party.firstName || party.lastName) {
          customerName = `${party.firstName || ""} ${party.lastName || ""}`.trim();
        }
      }

      return {
        id: payment._id.toString(),
        invoiceId: invoice?._id?.toString() || payment.invoiceId?.toString() || null,
        invoiceNumber: invoice?.invoiceNo || "N/A",
        amount: parseFloat(payment.amount || 0).toFixed(2),
        method: payment.method,
        reference: payment.reference || null,
        receiptDate: payment.receiptDate.toISOString(),
        createdAt: payment.createdAt.toISOString(),
        customer: customer
          ? {
              id: customer._id?.toString() || customer.toString(),
              name: customerName,
            }
          : undefined,
      };
    });

    return {
      success: true,
      data: formattedPayments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * Get invoice groups with their associated jobs
   * @param {Object} query - Query parameters (customerId, grouping)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of invoice groups with jobs
   */
  static async getInvoiceGroups(query, user) {
    const InvoiceGroup = require("../models/invoiceGroup.model");
    const InvoiceGroupJob = require("../models/invoiceGroupJob.model");
    const Customer = require("../models/customer.model");
    const Party = require("../models/party.model");

    const organizationId = user.activeOrganizationId || null;

    // Validation
    if (!query.grouping || !["DAY", "WEEK", "PO"].includes(query.grouping)) {
      throw new AppError("Invalid grouping method. Must be DAY, WEEK, or PO", HttpStatusCodes.BAD_REQUEST);
    }

    // Build filter
    const filter = {
      grouping: query.grouping,
    };

    if (organizationId) {
      filter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      filter.organizationId = null;
    }

    if (query.customerId) {
      if (!mongoose.Types.ObjectId.isValid(query.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }
      filter.customerId = new mongoose.Types.ObjectId(query.customerId);
    }

    // Fetch groups
    const groups = await InvoiceGroup.find(filter)
      .populate({
        path: "customerId",
        populate: {
          path: "partyId",
          select: "companyName",
        },
      })
      .sort({ periodStart: -1, createdAt: -1 })
      .lean();

    // Fetch jobs for each group
    const groupsWithJobs = await Promise.all(
      groups.map(async (group) => {
        const groupJobs = await InvoiceGroupJob.find({
          invoiceGroupId: group._id,
        })
          .populate({
            path: "jobId",
            populate: {
              path: "customerId",
              populate: {
                path: "partyId",
                select: "companyName",
              },
            },
          })
          .lean();

        const jobs = groupJobs
          .filter((gj) => gj.jobId)
          .map((gj) => {
            const job = gj.jobId;
            const customer = job.customerId;
            return {
              id: job._id.toString(),
              jobNo: job.jobNumber,
              customerId: customer ? customer._id.toString() : null,
              customer: customer
                ? {
                    id: customer._id.toString(),
                    party: customer.partyId
                      ? {
                          companyName: customer.partyId.companyName || null,
                        }
                      : null,
                  }
                : null,
              date: job.date ? new Date(job.date + "T00:00:00.000Z").toISOString() : null,
              description: job.notes || "Delivery service",
              chargeAmount: parseFloat(job.customerCharge || 0),
              status: job.status === "CLOSED" ? "LOCKED" : job.status,
            };
          });

        return {
          id: group._id.toString(),
          customerId: group.customerId ? group.customerId._id.toString() : null,
          customer: group.customerId
            ? {
                id: group.customerId._id.toString(),
                party: group.customerId.partyId
                  ? {
                      companyName: group.customerId.partyId.companyName || null,
                    }
                  : null,
              }
            : null,
          periodStart: group.periodStart.toISOString(),
          periodEnd: group.periodEnd.toISOString(),
          grouping: group.grouping,
          status: group.status,
          jobs,
          createdAt: group.createdAt.toISOString(),
          updatedAt: group.updatedAt.toISOString(),
        };
      })
    );

    return groupsWithJobs;
  }

  /**
   * Get available jobs that can be added to invoice groups
   * @param {Object} query - Query parameters (customerId)
   * @param {Object} user - Authenticated user
   * @returns {Array} Array of available jobs
   */
  static async getAvailableJobs(query, user) {
    const InvoiceGroupJob = require("../models/invoiceGroupJob.model");
    const InvoiceLineItem = require("../models/invoiceLineItem.model");

    const organizationId = user.activeOrganizationId || null;

    // Build filter for jobs
    const jobFilter = {
      status: { $in: ["CLOSED"] }, // Only closed jobs are available
    };

    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    if (query.customerId) {
      if (!mongoose.Types.ObjectId.isValid(query.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }
      jobFilter.customerId = new mongoose.Types.ObjectId(query.customerId);
    }

    // Fetch all closed jobs
    const allJobs = await Job.find(jobFilter)
      .populate({
        path: "customerId",
        populate: {
          path: "partyId",
          select: "companyName",
        },
      })
      .lean();

    // Get job IDs that are already in groups
    const groupedJobIds = await InvoiceGroupJob.distinct("jobId");

    // Get job IDs that are already invoiced
    const invoicedJobIds = await InvoiceLineItem.distinct("jobId", {
      jobId: { $ne: null },
    });

    // Filter out jobs that are already grouped or invoiced
    const availableJobs = allJobs
      .filter((job) => {
        const jobIdStr = job._id.toString();
        return (
          !groupedJobIds.some((id) => id.toString() === jobIdStr) &&
          !invoicedJobIds.some((id) => id.toString() === jobIdStr)
        );
      })
      .map((job) => {
        const customer = job.customerId;
        return {
          id: job._id.toString(),
          jobNo: job.jobNumber,
          customerId: customer ? customer._id.toString() : null,
          customer: customer
            ? {
                id: customer._id.toString(),
                party: customer.partyId
                  ? {
                      companyName: customer.partyId.companyName || null,
                    }
                  : null,
              }
            : null,
          date: job.date ? new Date(job.date + "T00:00:00.000Z").toISOString() : null,
          description: job.notes || "Delivery service",
          chargeAmount: parseFloat(job.customerCharge || 0),
          status: job.status === "CLOSED" ? "LOCKED" : job.status,
        };
      });

    return availableJobs;
  }

  /**
   * Group available jobs into invoice groups
   * @param {Object} data - Request data (customerId, grouping)
   * @param {Object} user - Authenticated user
   * @returns {Object} Summary of groups created
   */
  static async groupJobs(data, user) {
    const InvoiceGroup = require("../models/invoiceGroup.model");
    const InvoiceGroupJob = require("../models/invoiceGroupJob.model");
    const InvoiceLineItem = require("../models/invoiceLineItem.model");

    const organizationId = user.activeOrganizationId || null;

    // Validation
    if (!data.grouping || !["DAY", "WEEK", "PO"].includes(data.grouping)) {
      throw new AppError("Invalid grouping method. Must be DAY, WEEK, or PO", HttpStatusCodes.BAD_REQUEST);
    }

    // Build filter for available jobs
    const jobFilter = {
      status: "CLOSED",
    };

    if (organizationId) {
      jobFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      jobFilter.organizationId = null;
    }

    if (data.customerId) {
      if (!mongoose.Types.ObjectId.isValid(data.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }
      jobFilter.customerId = new mongoose.Types.ObjectId(data.customerId);
    }

    // Fetch all closed jobs
    const allJobs = await Job.find(jobFilter).lean();

    // Get job IDs that are already in groups
    const groupedJobIds = await InvoiceGroupJob.distinct("jobId");

    // Get job IDs that are already invoiced
    const invoicedJobIds = await InvoiceLineItem.distinct("jobId", {
      jobId: { $ne: null },
    });

    // Filter available jobs
    const availableJobs = allJobs.filter((job) => {
      const jobIdStr = job._id.toString();
      return (
        !groupedJobIds.some((id) => id.toString() === jobIdStr) &&
        !invoicedJobIds.some((id) => id.toString() === jobIdStr)
      );
    });

    if (availableJobs.length === 0) {
      return {
        groupsCreated: 0,
        jobsGrouped: 0,
      };
    }

    // Group jobs by customer and grouping method
    const groupedJobs = {};
    const session = await mongoose.startSession();
    let transactionStarted = false;

    try {
      session.startTransaction();
      transactionStarted = true;

      for (const job of availableJobs) {
        const customerId = job.customerId.toString();
        let groupKey;

        if (data.grouping === "DAY") {
          // Group by customer + date
          const dateStr = job.date;
          groupKey = `${customerId}-${dateStr}`;

          if (!groupedJobs[groupKey]) {
            const dateObj = new Date(dateStr + "T00:00:00.000Z");
            const periodStart = new Date(dateObj);
            periodStart.setHours(0, 0, 0, 0);
            const periodEnd = new Date(dateObj);
            periodEnd.setHours(23, 59, 59, 999);
            groupedJobs[groupKey] = {
              customerId: new mongoose.Types.ObjectId(customerId),
              periodStart,
              periodEnd,
              grouping: "DAY",
              jobs: [],
            };
          }
        } else if (data.grouping === "WEEK") {
          // Group by customer + week (Monday to Sunday)
          const dateObj = new Date(job.date + "T00:00:00.000Z");
          const dayOfWeek = dateObj.getDay();
          const monday = new Date(dateObj);
          monday.setDate(dateObj.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          monday.setHours(0, 0, 0, 0);
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);
          sunday.setHours(23, 59, 59, 999);

          groupKey = `${customerId}-${monday.toISOString().split("T")[0]}`;

          if (!groupedJobs[groupKey]) {
            groupedJobs[groupKey] = {
              customerId: new mongoose.Types.ObjectId(customerId),
              periodStart: monday,
              periodEnd: sunday,
              grouping: "WEEK",
              jobs: [],
            };
          }
        } else if (data.grouping === "PO") {
          // Group by customer + purchase order
          // Note: Job model doesn't have purchaseOrderNumber, so we'll use a placeholder
          // In a real implementation, you might extract PO from job notes or add a PO field
          const po = job.notes?.match(/PO[:\s]+([A-Z0-9-]+)/i)?.[1] || "NO-PO";
          groupKey = `${customerId}-${po}`;

          if (!groupedJobs[groupKey]) {
            // For PO grouping, find min/max dates from jobs
            groupedJobs[groupKey] = {
              customerId: new mongoose.Types.ObjectId(customerId),
              periodStart: null,
              periodEnd: null,
              grouping: "PO",
              purchaseOrderNumber: po,
              jobs: [],
            };
          }
        }

        groupedJobs[groupKey].jobs.push(job);
      }

      // For PO groups, calculate periodStart and periodEnd from job dates
      for (const groupKey in groupedJobs) {
        const group = groupedJobs[groupKey];
        if (group.grouping === "PO" && group.jobs.length > 0) {
          const dates = group.jobs.map((j) => new Date(j.date + "T00:00:00.000Z"));
          group.periodStart = new Date(Math.min(...dates));
          group.periodStart.setHours(0, 0, 0, 0);
          group.periodEnd = new Date(Math.max(...dates));
          group.periodEnd.setHours(23, 59, 59, 999);
        }
      }

      // Create groups and link jobs
      let groupsCreated = 0;
      let jobsGrouped = 0;

      for (const groupKey in groupedJobs) {
        const groupData = groupedJobs[groupKey];
        if (groupData.jobs.length === 0) continue;

        // Check if group already exists
        const existingGroup = await InvoiceGroup.findOne({
          organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
          customerId: groupData.customerId,
          grouping: groupData.grouping,
          periodStart: groupData.periodStart,
          periodEnd: groupData.periodEnd,
          ...(groupData.purchaseOrderNumber ? { purchaseOrderNumber: groupData.purchaseOrderNumber } : {}),
        }).session(session);

        let group;
        if (existingGroup) {
          group = existingGroup;
        } else {
          group = await InvoiceGroup.create(
            [
              {
                organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
                customerId: groupData.customerId,
                periodStart: groupData.periodStart,
                periodEnd: groupData.periodEnd,
                grouping: groupData.grouping,
                status: "DRAFT",
                purchaseOrderNumber: groupData.purchaseOrderNumber || null,
              },
            ],
            { session }
          );
          group = group[0];
          groupsCreated++;
        }

        // Link jobs to group
        for (const job of groupData.jobs) {
          const existingLink = await InvoiceGroupJob.findOne({
            invoiceGroupId: group._id,
            jobId: job._id,
          }).session(session);

          if (!existingLink) {
            await InvoiceGroupJob.create(
              [
                {
                  invoiceGroupId: group._id,
                  jobId: job._id,
                },
              ],
              { session }
            );
            jobsGrouped++;
          }
        }
      }

      await session.commitTransaction();
      await session.endSession();

      return {
        groupsCreated,
        jobsGrouped,
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.warn("Transaction already aborted:", abortError.message);
        }
      }
      try {
        await session.endSession();
      } catch (endError) {
        console.warn("Session already ended:", endError.message);
      }
      throw error;
    }
  }

  /**
   * Remove a job from an invoice group
   * @param {string} groupId - Invoice group ID
   * @param {string} jobId - Job ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async removeJobFromGroup(groupId, jobId, user) {
    const InvoiceGroup = require("../models/invoiceGroup.model");
    const InvoiceGroupJob = require("../models/invoiceGroupJob.model");

    const organizationId = user.activeOrganizationId || null;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      throw new AppError("Invalid group ID", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new AppError("Invalid job ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Find group and verify ownership
    const groupFilter = {
      _id: new mongoose.Types.ObjectId(groupId),
    };

    if (organizationId) {
      groupFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      groupFilter.organizationId = null;
    }

    const group = await InvoiceGroup.findOne(groupFilter);

    if (!group) {
      throw new AppError("Group not found", HttpStatusCodes.NOT_FOUND);
    }

    // Verify group status
    if (group.status === "READY") {
      throw new AppError("Cannot remove job from ready group", HttpStatusCodes.BAD_REQUEST);
    }

    // Find and remove job link
    const jobLink = await InvoiceGroupJob.findOne({
      invoiceGroupId: group._id,
      jobId: new mongoose.Types.ObjectId(jobId),
    });

    if (!jobLink) {
      throw new AppError("Job not found in group", HttpStatusCodes.NOT_FOUND);
    }

    await InvoiceGroupJob.deleteOne({ _id: jobLink._id });

    // Optionally delete group if empty
    const remainingJobs = await InvoiceGroupJob.countDocuments({
      invoiceGroupId: group._id,
    });

    if (remainingJobs === 0) {
      await InvoiceGroup.deleteOne({ _id: group._id });
    }

    return {
      message: "Job removed from group",
    };
  }

  /**
   * Mark an invoice group as ready
   * @param {string} groupId - Invoice group ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated group
   */
  static async markGroupAsReady(groupId, user) {
    const InvoiceGroup = require("../models/invoiceGroup.model");
    const InvoiceGroupJob = require("../models/invoiceGroupJob.model");

    const organizationId = user.activeOrganizationId || null;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      throw new AppError("Invalid group ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Find group and verify ownership
    const groupFilter = {
      _id: new mongoose.Types.ObjectId(groupId),
    };

    if (organizationId) {
      groupFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      groupFilter.organizationId = null;
    }

    const group = await InvoiceGroup.findOne(groupFilter);

    if (!group) {
      throw new AppError("Group not found", HttpStatusCodes.NOT_FOUND);
    }

    // Verify group has at least one job
    const jobCount = await InvoiceGroupJob.countDocuments({
      invoiceGroupId: group._id,
    });

    if (jobCount === 0) {
      throw new AppError("Group must have at least one job", HttpStatusCodes.BAD_REQUEST);
    }

    // Update status
    group.status = "READY";
    await group.save();

    return {
      id: group._id.toString(),
      status: group.status,
    };
  }

  /**
   * Create invoices from ready invoice groups
   * @param {Object} data - Request data (grouping, customerId)
   * @param {Object} user - Authenticated user
   * @returns {Object} Summary of invoices created
   */
  static async createInvoicesFromGroups(data, user) {
    const InvoiceGroup = require("../models/invoiceGroup.model");
    const InvoiceGroupJob = require("../models/invoiceGroupJob.model");
    const Customer = require("../models/customer.model");

    const organizationId = user.activeOrganizationId || null;

    // Build filter for ready groups
    const groupFilter = {
      status: "READY",
    };

    if (organizationId) {
      groupFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      groupFilter.organizationId = null;
    }

    if (data.grouping) {
      if (!["DAY", "WEEK", "PO"].includes(data.grouping)) {
        throw new AppError("Invalid grouping method. Must be DAY, WEEK, or PO", HttpStatusCodes.BAD_REQUEST);
      }
      groupFilter.grouping = data.grouping;
    }

    if (data.customerId) {
      if (!mongoose.Types.ObjectId.isValid(data.customerId)) {
        throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
      }
      groupFilter.customerId = new mongoose.Types.ObjectId(data.customerId);
    }

    // Fetch ready groups
    const readyGroups = await InvoiceGroup.find(groupFilter)
      .populate("customerId")
      .lean();

    if (readyGroups.length === 0) {
      throw new AppError("No ready groups found", HttpStatusCodes.BAD_REQUEST);
    }

    const session = await mongoose.startSession();
    let transactionStarted = false;
    const createdInvoiceIds = [];

    try {
      session.startTransaction();
      transactionStarted = true;

      for (const group of readyGroups) {
        // Get jobs in group
        const groupJobs = await InvoiceGroupJob.find({
          invoiceGroupId: group._id,
        })
          .populate("jobId")
          .session(session)
          .lean();

        if (groupJobs.length === 0) continue;

        const jobs = groupJobs.map((gj) => gj.jobId).filter(Boolean);

        // Get customer
        const customer = await Customer.findById(group.customerId).session(session).lean();

        if (!customer) continue;

        // Calculate totals
        let totalExGst = 0;
        for (const job of jobs) {
          totalExGst += parseFloat(job.customerCharge || 0);
        }

        const gst = totalExGst * 0.1; // 10% GST
        const totalIncGst = totalExGst + gst;

        // Generate invoice number
        const currentYear = new Date().getFullYear();
        const invoiceNo = await this.generateInvoiceNumber(customer, currentYear);

        // Set dates
        const issueDate = new Date();
        const paymentTerms = customer.termsDays || 14;
        const dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + paymentTerms);

        // Create invoice
        const invoice = await Invoice.create(
          [
            {
              invoiceNo,
              customerId: customer._id,
              issueDate,
              dueDate,
              status: "PENDING", // Ready to be sent
              totalExGst,
              gst,
              totalIncGst,
              balanceDue: totalIncGst,
              grouping: group.grouping,
              purchaseOrderNumber: group.purchaseOrderNumber || null,
              organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
            },
          ],
          { session }
        );

        const createdInvoice = invoice[0];
        createdInvoiceIds.push(createdInvoice._id.toString());

        // Create line items
        for (const job of jobs) {
          await InvoiceLineItem.create(
            [
              {
                invoiceId: createdInvoice._id,
                jobId: job._id,
                allocatorRowId: job.allocatorRowId || null,
                date: job.date,
                jobNumber: job.jobNumber || `JOB-${job._id}`,
                description: job.notes || "Delivery service",
                quantity: 1,
                unitPrice: parseFloat(job.customerCharge || 0),
                total: parseFloat(job.customerCharge || 0),
              },
            ],
            { session }
          );
        }

        // Mark group as processed (delete it or add a status field)
        await InvoiceGroup.deleteOne({ _id: group._id }).session(session);
      }

      await session.commitTransaction();
      await session.endSession();

      return {
        invoicesCreated: createdInvoiceIds.length,
        invoiceIds: createdInvoiceIds,
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.warn("Transaction already aborted:", abortError.message);
        }
      }
      try {
        await session.endSession();
      } catch (endError) {
        console.warn("Session already ended:", endError.message);
      }
      throw error;
    }
  }

  /**
   * Create a manual invoice (not from jobs)
   * @param {Object} data - Request data (customerId, paymentTerms, lineItems, notes, status)
   * @param {Object} user - Authenticated user
   * @returns {Object} Created invoice
   */
  static async createManualInvoice(data, user) {
    const Customer = require("../models/customer.model");

    const organizationId = user.activeOrganizationId || null;

    // Validation
    const errors = [];

    if (!data.customerId) {
      errors.push({ field: "customerId", message: "Customer ID is required" });
    }

    if (!data.lineItems || !Array.isArray(data.lineItems) || data.lineItems.length === 0) {
      errors.push({ field: "lineItems", message: "At least one line item is required" });
    }

    if (data.lineItems && Array.isArray(data.lineItems)) {
      data.lineItems.forEach((line, index) => {
        if (!line.description || line.description.trim() === "") {
          errors.push({ field: `lineItems[${index}].description`, message: "Description is required" });
        }
        if (!line.quantity || parseFloat(line.quantity) <= 0) {
          errors.push({ field: `lineItems[${index}].quantity`, message: "Quantity must be greater than 0" });
        }
        if (line.unitPrice === undefined || line.unitPrice === null || parseFloat(line.unitPrice) < 0) {
          errors.push({ field: `lineItems[${index}].unitPrice`, message: "Unit price must be 0 or greater" });
        }
      });
    }

    if (!data.status || !["DRAFT", "PENDING", "SENT"].includes(data.status)) {
      errors.push({ field: "status", message: "Status must be DRAFT, PENDING, or SENT" });
    }

    if (errors.length > 0) {
      const error = new AppError("Validation failed", HttpStatusCodes.BAD_REQUEST);
      error.errors = errors;
      throw error;
    }

    // Verify customer exists
    const customerFilter = {
      _id: new mongoose.Types.ObjectId(data.customerId),
    };

    if (organizationId) {
      customerFilter.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      customerFilter.organizationId = null;
    }

    const customer = await Customer.findOne(customerFilter).lean();

    if (!customer) {
      throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
    }

    // Calculate totals
    let totalExGst = 0;
    for (const line of data.lineItems) {
      totalExGst += parseFloat(line.quantity || 0) * parseFloat(line.unitPrice || 0);
    }

    const gst = totalExGst * 0.1; // 10% GST
    const totalIncGst = totalExGst + gst;

    // Generate invoice number
    const currentYear = new Date().getFullYear();
    const invoiceNo = await this.generateInvoiceNumber(customer, currentYear);

    // Set dates
    const issueDate = new Date();
    let dueDate = new Date(issueDate);

    if (data.paymentTerms) {
      const termsMap = {
        NET_7: 7,
        NET_14: 14,
        NET_30: 30,
        NET_60: 60,
        DUE_ON_RECEIPT: 0,
      };
      const days = termsMap[data.paymentTerms] || customer.termsDays || 14;
      dueDate.setDate(dueDate.getDate() + days);
    } else {
      dueDate.setDate(dueDate.getDate() + (customer.termsDays || 14));
    }

    // Create invoice
    const invoice = await Invoice.create({
      invoiceNo,
      customerId: customer._id,
      issueDate,
      dueDate,
      status: data.status,
      totalExGst,
      gst,
      totalIncGst,
      balanceDue: totalIncGst,
      grouping: "DAY", // Default for manual invoices
      organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
    });

    // Create line items
    for (const line of data.lineItems) {
      await InvoiceLineItem.create({
        invoiceId: invoice._id,
        description: line.description.trim(),
        quantity: parseFloat(line.quantity),
        unitPrice: parseFloat(line.unitPrice),
        total: parseFloat(line.quantity) * parseFloat(line.unitPrice),
        date: issueDate.toISOString().split("T")[0],
      });
    }

    return {
      id: invoice._id.toString(),
      invoiceNo: invoice.invoiceNo,
      customerId: invoice.customerId.toString(),
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      status: invoice.status,
      totalExGst: invoice.totalExGst,
      gst: invoice.gst,
      totalIncGst: invoice.totalIncGst,
      balanceDue: invoice.balanceDue,
    };
  }

  /**
   * Send an invoice via email and create delivery tracking entries.
   * @param {string} invoiceId
   * @param {Object} body - email overrides (to, cc, bcc, message, attachments)
   * @param {Object} user
   * @returns {{deliveryId: string, deliveryIds: string[], invoiceId: string, status: string, sentAt: string, recipients: string[]}}
   */
  static async sendInvoice(invoiceId, body = {}, user) {
    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID", HttpStatusCodes.BAD_REQUEST);
    }

    const userOrgId = user.activeOrganizationId || null;

    const invoiceFilter = {
      _id: new mongoose.Types.ObjectId(invoiceId),
    };

    if (userOrgId) {
      invoiceFilter.organizationId = new mongoose.Types.ObjectId(userOrgId);
    } else {
      invoiceFilter.organizationId = null;
    }

    const invoice = await Invoice.findOne(invoiceFilter)
      .populate({
        path: "customerId",
        select: "accountsEmail accountsName primaryContactEmail primaryContactName tradingName legalCompanyName partyId billingEmail billingContactName",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName email",
        },
      })
      .lean();

    if (!invoice) {
      throw new AppError("Invoice not found", HttpStatusCodes.NOT_FOUND);
    }

    if (invoice.status === "VOID") {
      throw new AppError("Cannot send a void invoice", HttpStatusCodes.BAD_REQUEST);
    }

    const customer = invoice.customerId;

    const normalizeArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      return [value];
    };

    const normalizeEmail = (email) => {
      if (!email || typeof email !== "string") return null;
      const normalized = email.trim().toLowerCase();
      return normalized.length > 0 ? normalized : null;
    };

    const toSet = new Set();
    normalizeArray(body.to).forEach((email) => {
      const normalized = normalizeEmail(email);
      if (normalized) {
        toSet.add(normalized);
      }
    });

    const fallbackEmails = [
      customer?.accountsEmail,
      customer?.primaryContactEmail,
      customer?.billingEmail,
      customer?.partyId?.email,
    ];
    fallbackEmails.forEach((email) => {
      if (toSet.size === 0) {
        const normalized = normalizeEmail(email);
        if (normalized) {
          toSet.add(normalized);
        }
      }
    });

    if (toSet.size === 0) {
      throw new AppError("At least one recipient email is required", HttpStatusCodes.BAD_REQUEST);
    }

    const ccList = normalizeArray(body.cc)
      .map(normalizeEmail)
      .filter(Boolean);

    const bccList = normalizeArray(body.bcc)
      .map(normalizeEmail)
      .filter(Boolean);

    const attachments = normalizeArray(body.attachments).filter((item) => typeof item === "string" && item.trim().length > 0);
    const recipients = Array.from(toSet);

    const organizationObjectId =
      invoice.organizationId && mongoose.Types.ObjectId.isValid(invoice.organizationId)
        ? new mongoose.Types.ObjectId(invoice.organizationId)
        : userOrgId && mongoose.Types.ObjectId.isValid(userOrgId)
        ? new mongoose.Types.ObjectId(userOrgId)
        : null;

    const sentAt = new Date();
    const recipientName =
      customer?.accountsName ||
      customer?.primaryContactName ||
      customer?.billingContactName ||
      customer?.tradingName ||
      customer?.legalCompanyName ||
      [customer?.partyId?.firstName, customer?.partyId?.lastName].filter(Boolean).join(" ").trim() ||
      customer?.partyId?.companyName ||
      null;

    // Placeholder email send (integrate with provider/queue as needed)
    const subject = `Invoice ${invoice.invoiceNo}`;
    console.info(
      `[InvoiceService] Sending invoice ${invoice.invoiceNo} to ${recipients.join(", ")} (cc: ${ccList.join(
        ", "
      ) || "none"})`
    );

    const deliveries = [];
    for (const recipientEmail of recipients) {
      const delivery = await InvoiceDeliveryEvent.create({
        invoiceId: invoice._id,
        organizationId: organizationObjectId,
        recipientEmail,
        recipientName,
        sentAt,
        currentStatus: "SENT",
        opensCount: 0,
        clicksCount: 0,
        engagementScore: 0,
        metadata: {
          cc: ccList,
          bcc: bccList,
          message: body.message || null,
          attachments,
          subject,
        },
      });

      await InvoiceDeliveryEventLog.create({
        deliveryEventId: delivery._id,
        organizationId: organizationObjectId,
        eventType: "SENT",
        timestamp: sentAt,
        metadata: {
          cc: ccList,
          bcc: bccList,
          message: body.message || null,
          attachments,
        },
      });

      deliveries.push(delivery);
    }

    if (["DRAFT", "PENDING"].includes(invoice.status)) {
      await Invoice.updateOne(
        { _id: invoice._id },
        {
          $set: { status: "SENT" },
        }
      );
    }

    const primaryDelivery = deliveries[0];

    return {
      deliveryId: primaryDelivery._id.toString(),
      deliveryIds: deliveries.map((delivery) => delivery._id.toString()),
      invoiceId: invoice._id.toString(),
      status: primaryDelivery.currentStatus,
      sentAt: sentAt.toISOString(),
      recipients,
    };
  }
}

module.exports = InvoiceService;

