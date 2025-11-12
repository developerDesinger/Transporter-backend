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
      const validStatuses = ["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"];
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
        } else if (invoice.status === "DRAFT") {
          calculatedStatus = "DRAFT";
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
      } else if (invoice.status === "DRAFT" && newBalanceDue === invoiceTotal) {
        // No payment applied (edge case), set to SENT
        newStatus = "SENT";
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
}

module.exports = InvoiceService;

