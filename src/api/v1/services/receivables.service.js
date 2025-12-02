const mongoose = require("mongoose");
const Invoice = require("../models/invoice.model");
const InvoiceLineItem = require("../models/invoiceLineItem.model");
const InvoicePayment = require("../models/invoicePayment.model");
const Receipt = require("../models/receipt.model");
const ReceiptAllocation = require("../models/receiptAllocation.model");
const PaymentBatch = require("../models/paymentBatch.model");
const PaymentBatchLine = require("../models/paymentBatchLine.model");
const User = require("../models/user.model");
const PaymentAnomaly = require("../models/paymentAnomaly.model");
const PaymentAnomalyTimeline = require("../models/paymentAnomalyTimeline.model");
const Statement = require("../models/statement.model");
const StatementSchedule = require("../models/statementSchedule.model");
const Customer = require("../models/customer.model");
const Party = require("../models/party.model");
const Job = require("../models/job.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const normalizeOrgId = (queryOrgId, userOrgId) => {
  const effectiveId = queryOrgId || userOrgId || null;
  if (!effectiveId) return null;
  if (!mongoose.Types.ObjectId.isValid(effectiveId)) {
    throw new AppError("Invalid organization context", HttpStatusCodes.BAD_REQUEST);
  }
  return new mongoose.Types.ObjectId(effectiveId);
};

const withCustomerName = (customer) => {
  if (!customer) return "Unknown";
  if (customer.tradingName) return customer.tradingName;
  if (customer.legalCompanyName) return customer.legalCompanyName;
  const party = customer.partyId;
  if (!party) return "Unknown";
  if (party.companyName) return party.companyName;
  return [party.firstName, party.lastName].filter(Boolean).join(" ").trim() || "Unknown";
};

class ReceivablesService {
  static async getSummary(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const today = query.date
      ? new Date(`${query.date}T00:00:00.000Z`)
      : new Date();
    today.setHours(0, 0, 0, 0);

    const invoiceFilter = {
      organizationId: orgId,
      status: { $nin: ["PAID", "VOID"] },
    };

    const invoices = await Invoice.find(invoiceFilter).select("balanceDue dueDate").lean();

    let totalReceivables = 0;
    let dueTodayAmount = 0;
    let dueTodayCount = 0;
    let overdueAmount = 0;

    invoices.forEach((invoice) => {
      const balance = Number(invoice.balanceDue || 0);
      const dueDate = new Date(invoice.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      if (balance > 0) {
        totalReceivables += balance;
        if (dueDate.getTime() === today.getTime()) {
          dueTodayAmount += balance;
          dueTodayCount += 1;
        } else if (dueDate.getTime() < today.getTime()) {
          overdueAmount += balance;
        }
      }
    });

    // Calculate unallocated count: receipts where allocated amount < receipt amount
    const receipts = await Receipt.find({
      organizationId: orgId,
      amount: { $gt: 0 },
    })
      .select("_id amount")
      .lean();

    const receiptIds = receipts.map((r) => r._id);
    const allocations = await ReceiptAllocation.aggregate([
      { $match: { receiptId: { $in: receiptIds } } },
      {
        $group: {
          _id: "$receiptId",
          allocated: { $sum: "$amount" },
        },
      },
    ]);

    const allocationMap = allocations.reduce((acc, allocation) => {
      acc[allocation._id.toString()] = allocation.allocated;
      return acc;
    }, {});

    let unallocatedCount = 0;
    receipts.forEach((receipt) => {
      const allocated = Number(allocationMap[receipt._id.toString()] || 0);
      const amount = Number(receipt.amount || 0);
      const remaining = amount - allocated;
      if (remaining > 0) {
        unallocatedCount += 1;
      }
    });

    const openAnomaliesCount = await PaymentAnomaly.countDocuments({
      organizationId: orgId,
      status: { $in: ["Open", "Investigating"] },
    });

    return {
      totalReceivables,
      dueToday: {
        amount: dueTodayAmount,
        count: dueTodayCount,
      },
      overdueAmount,
      unallocatedCount,
      openAnomaliesCount,
    };
  }

  static async getDueToday(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const today = query.date
      ? new Date(`${query.date}T00:00:00.000Z`)
      : new Date();
    today.setHours(0, 0, 0, 0);

    const invoices = await Invoice.find({
      organizationId: orgId,
      dueDate: {
        $gte: new Date(today),
        $lte: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
      },
      balanceDue: { $gt: 0 },
      status: { $in: ["SENT", "PARTIAL", "OVERDUE"] },
    })
      .populate({
        path: "customerId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .lean();

    const invoiceIds = invoices.map((invoice) => invoice._id);
    const lineItems = await InvoiceLineItem.find({ invoiceId: { $in: invoiceIds } })
      .select("invoiceId jobId jobNumber")
      .lean();

    const jobMap = {};
    lineItems.forEach((line) => {
      if (!jobMap[line.invoiceId]) {
        jobMap[line.invoiceId] = {
          jobId: line.jobId ? line.jobId.toString() : null,
          jobNo: line.jobNumber || null,
        };
      }
    });

    return invoices.map((invoice) => {
      const customerName = withCustomerName(invoice.customerId);
      const jobInfo = jobMap[invoice._id] || { jobId: null, jobNo: null };
      const total = Number(invoice.totalIncGst || 0);
      const balance = Number(invoice.balanceDue || 0);
      const paid = total - balance;
      return {
        id: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNo,
        customer: { name: customerName },
        job: jobInfo,
        issueDate: invoice.issueDate ? invoice.issueDate.toISOString().split("T")[0] : null,
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString().split("T")[0] : null,
        expectedPayment: null,
        total,
        paid,
        balanceDue: balance,
        status: invoice.status,
      };
    });
  }

  static async getCalendar(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);

    // Validation
    if (!query.month || !query.year) {
      throw new AppError("Month and year are required", HttpStatusCodes.BAD_REQUEST);
    }

    const month = Number(query.month);
    const year = Number(query.year);

    if (month < 1 || month > 12) {
      throw new AppError("Month must be between 1 and 12", HttpStatusCodes.BAD_REQUEST);
    }

    // Calculate date range for the month
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // Fetch invoices for the month
    const invoices = await Invoice.find({
      organizationId: orgId,
      balanceDue: { $gt: 0 },
      status: { $nin: ["PAID", "VOID"] },
      dueDate: { $gte: startOfMonth, $lte: endOfMonth },
    })
      .populate({
        path: "customerId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ dueDate: 1, invoiceNo: 1 })
      .lean();

    // Group invoices by date
    const dates = {};
    invoices.forEach((invoice) => {
      const dateKey = invoice.dueDate.toISOString().split("T")[0];
      if (!dates[dateKey]) {
        dates[dateKey] = [];
      }

      // Format due date as ISO 8601 timestamp
      const dueDate = new Date(invoice.dueDate);
      dueDate.setHours(0, 0, 0, 0);

      dates[dateKey].push({
        id: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNo,
        customer: {
          name: withCustomerName(invoice.customerId),
        },
        balanceDue: (invoice.balanceDue || 0).toFixed(2),
        dueDate: dueDate.toISOString(),
        total: (invoice.totalIncGst || 0).toFixed(2),
        status: invoice.status || "PENDING",
      });
    });

    return {
      dates,
    };
  }

  static async getPayments(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;
    const searchRegex = query.search ? new RegExp(query.search.trim(), "i") : null;

    const match = {
      organizationId: orgId,
    };

    if (searchRegex) {
      match.$or = [
        { receiptNumber: searchRegex },
        { reference: searchRegex },
      ];
    }

    const [payments, total] = await Promise.all([
      Receipt.find(match)
        .populate({
          path: "customerId",
          populate: {
            path: "partyId",
            select: "companyName firstName lastName",
          },
        })
        .sort({ receiptDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Receipt.countDocuments(match),
    ]);

    const receiptIds = payments.map((payment) => payment._id);
    const allocations = await ReceiptAllocation.aggregate([
      { $match: { receiptId: { $in: receiptIds } } },
      {
        $group: {
          _id: "$receiptId",
          allocated: { $sum: "$amount" },
        },
      },
    ]);

    const allocationMap = allocations.reduce((acc, allocation) => {
      acc[allocation._id.toString()] = allocation.allocated;
      return acc;
    }, {});

    const data = payments.map((payment) => {
      const allocated = Number(allocationMap[payment._id.toString()] || 0);
      const amount = Number(payment.amount || 0);
      const remaining = amount - allocated;
      let status = "UNALLOCATED";
      if (remaining === 0 && allocated === amount) status = "ALLOCATED";
      else if (remaining < 0) status = "OVERPAID";
      else if (allocated > 0) status = "PARTIAL";

      return {
        id: payment._id.toString(),
        paymentNo: payment.receiptNumber,
        date: payment.receiptDate ? payment.receiptDate.toISOString().split("T")[0] : null,
        customer: withCustomerName(payment.customerId),
        reference: payment.reference || null,
        amount,
        allocated,
        remaining,
        status,
      };
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  static async generatePaymentNumber(organizationId) {
    const year = new Date().getFullYear();
    const prefix = `PAY-${year}-`;
    const pattern = new RegExp(`^${prefix}`);

    // Find last payment for this organization in current year
    const query = {
      receiptNumber: pattern,
    };

    if (organizationId) {
      query.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      query.organizationId = null;
    }

    const lastReceipt = await Receipt.findOne(query).sort({ receiptNumber: -1 }).lean();

    let sequence = 1;
    if (lastReceipt && lastReceipt.receiptNumber) {
      const parts = lastReceipt.receiptNumber.split("-");
      if (parts.length >= 3) {
        const lastSequence = parseInt(parts[2], 10);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      }
    }

    // Ensure uniqueness (retry if exists, max 10 attempts)
    let attempts = 0;
    let paymentNumber;
    let exists = true;

    while (exists && attempts < 10) {
      // Format with zero padding (e.g., 001, 002)
      paymentNumber = `${prefix}${String(sequence).padStart(3, "0")}`;

      // Check if payment number exists
      const existingReceipt = await Receipt.findOne({
        receiptNumber: paymentNumber,
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
      });

      if (!existingReceipt) {
        exists = false;
      } else {
        sequence++;
        attempts++;
      }
    }

    if (exists) {
      throw new AppError(
        "Unable to generate unique payment number",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    return paymentNumber;
  }

  static async createPayment(data, user) {
    const orgId = normalizeOrgId(data.organizationId, user.activeOrganizationId);

    // Validation
    if (!data.customerId) {
      throw new AppError("Customer ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(data.customerId)) {
      throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
    }

    const amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new AppError("Amount must be greater than 0", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.receiptDate) {
      throw new AppError("Receipt date is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.receiptDate)) {
      throw new AppError(
        "Receipt date must be in YYYY-MM-DD format",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify customer exists
    const customer = await Customer.findById(data.customerId)
      .populate("partyId", "companyName firstName lastName")
      .lean();

    if (!customer) {
      throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
    }

    // Generate payment number
    const paymentNumber = await ReceivablesService.generatePaymentNumber(orgId);

    // Parse receipt date
    const receiptDate = new Date(`${data.receiptDate}T00:00:00.000Z`);

    // Validate payment method
    const validMethods = ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "BPAY", "OTHER"];
    const paymentMethod = data.method || "BANK_TRANSFER";
    if (!validMethods.includes(paymentMethod)) {
      throw new AppError(
        `Payment method must be one of: ${validMethods.join(", ")}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Create receipt
    const receipt = await Receipt.create({
      receiptNumber: paymentNumber,
      customerId: new mongoose.Types.ObjectId(data.customerId),
      receiptDate,
      amount,
      paymentMethod,
      reference: data.reference || null,
      bankAccount: data.bankAccount || null,
      notes: data.notes || null,
      organizationId: orgId,
      createdBy: new mongoose.Types.ObjectId(user._id),
    });

    // Get allocations to calculate allocated/remaining
    const allocations = await ReceiptAllocation.find({
      receiptId: receipt._id,
    }).lean();

    const allocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    const remaining = amount - allocated;

    // Determine status
    let status = "UNALLOCATED";
    if (remaining === 0 && allocated === amount) {
      status = "ALLOCATED";
    } else if (remaining < 0) {
      status = "OVERPAID";
    } else if (allocated > 0) {
      status = "PARTIAL";
    }

    // Populate customer for response
    await receipt.populate({
      path: "customerId",
      populate: {
        path: "partyId",
        select: "companyName firstName lastName",
      },
    });

    const customerName = withCustomerName(receipt.customerId);

    return {
      id: receipt._id.toString(),
      paymentNo: receipt.receiptNumber,
      customerId: receipt.customerId._id.toString(),
      customer: {
        id: receipt.customerId._id.toString(),
        name: customerName,
      },
      amount: amount.toFixed(2),
      allocated: allocated.toFixed(2),
      remaining: remaining.toFixed(2),
      receiptDate: receipt.receiptDate.toISOString(),
      reference: receipt.reference || null,
      bankAccount: receipt.bankAccount || null,
      method: receipt.paymentMethod,
      notes: receipt.notes || null,
      status,
      createdAt: receipt.createdAt.toISOString(),
      createdBy: receipt.createdBy.toString(),
    };
  }

  static async getPaymentDetails(paymentId, user) {
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      throw new AppError("Invalid payment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const orgId = normalizeOrgId(user.organizationId, user.activeOrganizationId);
    const payment = await Receipt.findOne({
      _id: new mongoose.Types.ObjectId(paymentId),
      organizationId: orgId,
    })
      .populate({
        path: "customerId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .populate("createdBy", "name email")
      .lean();

    if (!payment) {
      throw new AppError("Payment not found", HttpStatusCodes.NOT_FOUND);
    }

    const allocations = await ReceiptAllocation.find({
      receiptId: payment._id,
    })
      .populate({
        path: "invoiceId",
        select: "invoiceNo dueDate balanceDue",
      })
      .lean();

    const allocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    const remaining = Number(payment.amount || 0) - allocated;

    return {
      paymentNo: payment.receiptNumber,
      date: payment.receiptDate ? payment.receiptDate.toISOString().split("T")[0] : null,
      customer: withCustomerName(payment.customerId),
      reference: payment.reference || null,
      amount: Number(payment.amount || 0),
      allocated,
      remaining,
    };
  }

  static async getBatches(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const status = query.status || null;
    const search = query.search ? query.search.trim() : null;

    // Build match filter
    const match = {
      organizationId: orgId,
    };

    // Add status filter
    if (status) {
      match.status = status;
    }

    // Add search filter
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: "i" } },
        { fileName: { $regex: search, $options: "i" } },
      ];
    }

    // Fetch batches with pagination
    const batches = await PaymentBatch.find(match)
      .populate("uploadedBy", "fullName name")
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    // Format response
    return batches.map((batch) => {
      const owner = batch.uploadedBy;
      const ownerName = owner?.fullName || owner?.name || "Unknown";

      return {
        id: batch._id.toString(),
        name: batch.name,
        owner: ownerName,
        uploadedAt: batch.createdAt ? batch.createdAt.toISOString() : null,
        fileName: batch.fileName,
        lines: batch.totalLines || 0,
        totalAmount: Number(batch.totalAmount || 0),
        processed: batch.processedLines || 0,
        matched: batch.matchedLines || 0,
        status: batch.status || "Pending",
      };
    });
  }

  static async getAnomalies(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const type = query.type || null;
    const status = query.status || null;
    const search = query.search ? query.search.trim() : null;

    // Build match filter
    const match = {
      organizationId: orgId,
    };

    // Add type filter
    if (type) {
      match.type = type;
    }

    // Add status filter
    if (status) {
      match.status = status;
    }

    // Fetch anomalies with populated payment and invoice
    let anomalies = await PaymentAnomaly.find(match)
      .populate({
        path: "paymentId",
        select: "receiptNumber receiptDate reference customerId",
        populate: {
          path: "customerId",
          select: "tradingName legalCompanyName partyId",
          populate: {
            path: "partyId",
            select: "companyName firstName lastName",
          },
        },
      })
      .populate({
        path: "invoiceId",
        select: "invoiceNo",
      })
      .sort({ createdAt: -1 })
      .lean();

    // Apply search filter after population (since we need to search in populated fields)
    if (search) {
      const searchLower = search.toLowerCase();
      anomalies = anomalies.filter((anomaly) => {
        const paymentNo = anomaly.paymentId?.receiptNumber || "";
        const customerName = withCustomerName(anomaly.paymentId?.customerId || null);
        const reference = anomaly.paymentId?.reference || "";
        return (
          paymentNo.toLowerCase().includes(searchLower) ||
          customerName.toLowerCase().includes(searchLower) ||
          reference.toLowerCase().includes(searchLower)
        );
      });
    }

    // Sort by status priority: Open (1), Investigating (2), Resolved (3)
    const statusOrder = { Open: 1, Investigating: 2, Resolved: 3 };
    anomalies.sort((a, b) => {
      const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Apply pagination
    const paginatedAnomalies = anomalies.slice(offset, offset + limit);

    // Format response
    return paginatedAnomalies.map((anomaly) => {
      const payment = anomaly.paymentId;
      const invoice = anomaly.invoiceId;
      const customerName = withCustomerName(payment?.customerId || null);

      return {
        type: anomaly.type,
        paymentNo: payment?.receiptNumber || "Unknown",
        customer: customerName,
        description: anomaly.description || "",
        variance: Number(anomaly.variance || 0),
        status: anomaly.status || "Open",
        expected: Number(anomaly.expectedAmount || 0),
        actual: Number(anomaly.actualAmount || 0),
        paymentDate: payment?.receiptDate ? payment.receiptDate.toISOString() : null,
        reference: payment?.reference || null,
        relatedInvoice: invoice?.invoiceNo || null,
        notes: anomaly.notes || null,
      };
    });
  }

  static async getAnomalyDetails(paymentNo, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    // Find receipt by receiptNumber
    const receipt = await Receipt.findOne({
      receiptNumber: paymentNo,
      organizationId: orgId,
    }).lean();

    if (!receipt) {
      throw new AppError("Payment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Find anomaly by paymentId
    const anomaly = await PaymentAnomaly.findOne({
      paymentId: receipt._id,
      organizationId: orgId,
    })
      .populate({
        path: "paymentId",
        select: "receiptNumber receiptDate reference customerId",
        populate: {
          path: "customerId",
          select: "tradingName legalCompanyName partyId",
          populate: {
            path: "partyId",
            select: "companyName firstName lastName",
          },
        },
      })
      .populate({
        path: "invoiceId",
        select: "invoiceNo",
      })
      .lean();

    if (!anomaly) {
      throw new AppError("Anomaly not found", HttpStatusCodes.NOT_FOUND);
    }

    // Fetch timeline events
    const timelineEvents = await PaymentAnomalyTimeline.find({
      anomalyId: anomaly._id,
    })
      .sort({ timestamp: 1, createdAt: 1 })
      .lean();

    const payment = anomaly.paymentId;
    const invoice = anomaly.invoiceId;
    const customerName = withCustomerName(payment?.customerId || null);

    // Format timeline
    const timeline = timelineEvents.map((event) => ({
      label: event.label,
      timestamp: event.timestamp ? event.timestamp.toISOString() : undefined,
      status: event.status === "resolved" ? "done" : event.status, // Map "resolved" to "done" for frontend
    }));

    return {
      type: anomaly.type,
      paymentNo: payment?.receiptNumber || "Unknown",
      customer: customerName,
      description: anomaly.description || "",
      variance: Number(anomaly.variance || 0),
      status: anomaly.status || "Open",
      expected: Number(anomaly.expectedAmount || 0),
      actual: Number(anomaly.actualAmount || 0),
      paymentDate: payment?.receiptDate ? payment.receiptDate.toISOString() : null,
      reference: payment?.reference || null,
      relatedInvoice: invoice?.invoiceNo || null,
      notes: anomaly.notes || null,
      timeline,
    };
  }

  static formatPeriodLabel(periodStart, periodEnd) {
    if (!periodStart || !periodEnd) return null;
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    
    // Check if it's a month period (first day to last day of same month)
    if (
      start.getUTCFullYear() === end.getUTCFullYear() &&
      start.getUTCMonth() === end.getUTCMonth() &&
      start.getUTCDate() === 1 &&
      end.getUTCDate() === new Date(end.getUTCFullYear(), end.getUTCMonth() + 1, 0).getUTCDate()
    ) {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
    }
    
    // Check if it's a quarter
    const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
    if (
      start.getUTCFullYear() === end.getUTCFullYear() &&
      start.getUTCMonth() === (quarter - 1) * 3 &&
      end.getUTCMonth() === quarter * 3 - 1
    ) {
      return `Q${quarter} ${start.getUTCFullYear()}`;
    }
    
    // Default: date range
    return `${start.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`;
  }

  static getOverdueLabel(dueDate) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    
    const daysDiff = Math.floor((today - due) / (1000 * 60 * 60 * 24));
    
    if (daysDiff <= 0) return null;
    if (daysDiff === 1) return "1 day overdue";
    if (daysDiff < 30) return `${daysDiff} days overdue`;
    if (daysDiff < 60) return "Over 30 days overdue";
    return "Over 60 days overdue";
  }

  static async getStatements(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const status = query.status || null;
    const customer = query.customer || null;
    const period = query.period || null;
    const search = query.search ? query.search.trim() : null;

    // Build match filter
    const match = {
      organizationId: orgId,
    };

    // Add status filter
    if (status) {
      match.status = status;
    }

    // Add customer filter
    if (customer) {
      if (mongoose.Types.ObjectId.isValid(customer)) {
        match.customerId = new mongoose.Types.ObjectId(customer);
      } else {
        // Will filter after population
      }
    }

    // Fetch statements with populated customer
    let statements = await Statement.find(match)
      .populate({
        path: "customerId",
        select: "tradingName legalCompanyName accountsEmail primaryContactEmail partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName email",
        },
      })
      .sort({ statementDate: -1, createdAt: -1 })
      .lean();

    // Apply customer name filter if needed
    if (customer && !mongoose.Types.ObjectId.isValid(customer)) {
      const customerLower = customer.toLowerCase();
      statements = statements.filter((stmt) => {
        const customerName = withCustomerName(stmt.customerId);
        return customerName.toLowerCase().includes(customerLower);
      });
    }

    // Apply period filter
    if (period) {
      statements = statements.filter((stmt) => {
        const periodLabel = ReceivablesService.formatPeriodLabel(stmt.periodStart, stmt.periodEnd);
        return periodLabel === period;
      });
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      statements = statements.filter((stmt) => {
        const statementNo = stmt.statementNumber || "";
        const customerName = withCustomerName(stmt.customerId);
        return (
          statementNo.toLowerCase().includes(searchLower) ||
          customerName.toLowerCase().includes(searchLower)
        );
      });
    }

    // Apply pagination
    const paginatedStatements = statements.slice(offset, offset + limit);

    // Format response and calculate invoiced/payments
    const formattedStatements = await Promise.all(
      paginatedStatements.map(async (stmt) => {
        const customer = stmt.customerId;
        const customerName = withCustomerName(customer);
        const customerEmail = customer?.accountsEmail || customer?.primaryContactEmail || customer?.partyId?.email || null;

        // Calculate invoiced amount from invoices in period
        const invoices = await Invoice.find({
          customerId: stmt.customerId?._id || stmt.customerId,
          organizationId: orgId,
          issueDate: {
            $gte: new Date(stmt.periodStart),
            $lte: new Date(stmt.periodEnd),
          },
        }).select("totalIncGst").lean();

        const invoiced = invoices.reduce((sum, inv) => sum + Number(inv.totalIncGst || 0), 0);

        // Calculate payments amount from receipts in period
        const receipts = await Receipt.find({
          customerId: stmt.customerId?._id || stmt.customerId,
          organizationId: orgId,
          receiptDate: {
            $gte: new Date(stmt.periodStart),
            $lte: new Date(stmt.periodEnd),
          },
        }).select("amount").lean();

        const payments = receipts.reduce((sum, rec) => sum + Number(rec.amount || 0), 0);

        return {
          statementNo: stmt.statementNumber,
          customer: customerName,
          email: customerEmail,
          date: stmt.statementDate ? stmt.statementDate.toISOString() : null,
          period: ReceivablesService.formatPeriodLabel(stmt.periodStart, stmt.periodEnd),
          opening: Number(stmt.openingBalance || 0),
          invoiced,
          payments,
          closing: Number(stmt.closingBalance || 0),
          status: stmt.status || "Draft",
        };
      })
    );

    return formattedStatements;
  }

  static async getStatementDetails(statementNo, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    // Find statement
    const statement = await Statement.findOne({
      statementNumber: statementNo,
      organizationId: orgId,
    })
      .populate({
        path: "customerId",
        select: "tradingName legalCompanyName accountsEmail primaryContactEmail partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName email",
        },
      })
      .lean();

    if (!statement) {
      throw new AppError("Statement not found", HttpStatusCodes.NOT_FOUND);
    }

    const customer = statement.customerId;
    const customerName = withCustomerName(customer);
    const customerEmail = customer?.accountsEmail || customer?.primaryContactEmail || customer?.partyId?.email || null;
    const customerId = customer?._id || customer;

    // Get invoices in period
    const invoices = await Invoice.find({
      customerId: customerId,
      organizationId: orgId,
      issueDate: {
        $gte: new Date(statement.periodStart),
        $lte: new Date(statement.periodEnd),
      },
    })
      .select("invoiceNo issueDate dueDate totalIncGst balanceDue")
      .sort({ issueDate: -1 })
      .lean();

    // Format invoices with overdue labels
    const formattedInvoices = invoices.map((inv) => {
      const total = Number(inv.totalIncGst || 0);
      const balance = Number(inv.balanceDue || 0);
      const paid = total - balance;
      const overdueLabel = ReceivablesService.getOverdueLabel(inv.dueDate);

      return {
        invoiceNo: inv.invoiceNo,
        issued: inv.issueDate ? inv.issueDate.toISOString() : null,
        due: inv.dueDate ? inv.dueDate.toISOString() : null,
        overdueLabel,
        amount: total,
        paid,
        balance,
      };
    });

    // Get payments in period
    const receipts = await Receipt.find({
      customerId: customerId,
      organizationId: orgId,
      receiptDate: {
        $gte: new Date(statement.periodStart),
        $lte: new Date(statement.periodEnd),
      },
    })
      .select("receiptNumber receiptDate reference amount")
      .sort({ receiptDate: -1 })
      .lean();

    // Format payments
    const formattedPayments = receipts.map((rec) => ({
      paymentNo: rec.receiptNumber,
      date: rec.receiptDate ? rec.receiptDate.toISOString() : null,
      reference: rec.reference || null,
      amount: Number(rec.amount || 0),
    }));

    // Calculate invoiced and payments
    const invoiced = invoices.reduce((sum, inv) => sum + Number(inv.totalIncGst || 0), 0);
    const payments = receipts.reduce((sum, rec) => sum + Number(rec.amount || 0), 0);

    return {
      statementNo: statement.statementNumber,
      customer: customerName,
      email: customerEmail,
      date: statement.statementDate ? statement.statementDate.toISOString() : null,
      period: ReceivablesService.formatPeriodLabel(statement.periodStart, statement.periodEnd),
      opening: Number(statement.openingBalance || 0),
      invoiced,
      payments,
      closing: Number(statement.closingBalance || 0),
      status: statement.status || "Draft",
      invoices: formattedInvoices,
      paymentsReceived: formattedPayments,
    };
  }

  static async generateStatementNumber(organizationId) {
    const year = new Date().getFullYear();
    const prefix = `STMT-${year}-`;
    const pattern = new RegExp(`^${prefix}`);

    // Find last statement for this organization in current year
    const query = {
      statementNumber: pattern,
    };

    if (organizationId) {
      query.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      query.organizationId = null;
    }

    const lastStatement = await Statement.findOne(query).sort({ statementNumber: -1 }).lean();

    let sequence = 1;
    if (lastStatement && lastStatement.statementNumber) {
      const parts = lastStatement.statementNumber.split("-");
      if (parts.length >= 3) {
        const lastSequence = parseInt(parts[2], 10);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      }
    }

    // Ensure uniqueness (retry if exists, max 10 attempts)
    let attempts = 0;
    let statementNumber;
    let exists = true;

    while (exists && attempts < 10) {
      // Format with zero padding (e.g., 001, 002)
      statementNumber = `${prefix}${String(sequence).padStart(3, "0")}`;

      // Check if statement number exists
      const existingStatement = await Statement.findOne({
        statementNumber,
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
      });

      if (!existingStatement) {
        exists = false;
      } else {
        sequence++;
        attempts++;
      }
    }

    if (exists) {
      throw new AppError(
        "Unable to generate unique statement number",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    return statementNumber;
  }

  static async generateStatementPDF(statement, customer, invoices, payments) {
    const PDFDocument = require("pdfkit");
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: "A4" });
        const chunks = [];

        // Collect PDF chunks
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        // Helper function to format date
        const formatDate = (date) => {
          if (!date) return "N/A";
          const d = new Date(date);
          return d.toISOString().split("T")[0];
        };

        // Helper function to format currency
        const formatCurrency = (amount) => {
          return `$${parseFloat(amount || 0).toFixed(2)}`;
        };

        // Header Section
        doc.fontSize(20).text("Account Statement", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Statement Number: ${statement.statementNumber}`, {
          align: "center",
        });
        doc.text(`Customer: ${withCustomerName(customer)}`, { align: "center" });
        doc.text(
          `Period: ${formatDate(statement.periodStart)} to ${formatDate(statement.periodEnd)}`,
          { align: "center" }
        );
        doc.text(`Generated: ${formatDate(new Date())}`, { align: "center" });
        doc.moveDown(2);

        // Summary Section
        doc.fontSize(14).text("Summary", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11);
        doc.text(`Opening Balance: ${formatCurrency(statement.openingBalance)}`);
        doc.text(`Total Invoiced: ${formatCurrency(statement.totalInvoiced)}`);
        doc.text(`Total Paid: ${formatCurrency(statement.totalPaid)}`);
        doc.text(`Closing Balance: ${formatCurrency(statement.closingBalance)}`);
        doc.moveDown(2);

        // Invoices Section
        if (invoices && invoices.length > 0) {
          doc.fontSize(14).text("Invoices", { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(10);
          invoices.forEach((inv) => {
            doc.text(
              `${inv.invoiceNo || "N/A"} - ${formatDate(inv.issueDate)} - ${formatCurrency(inv.totalIncGst || inv.total || 0)}`
            );
          });
          doc.moveDown(2);
        }

        // Payments Section
        if (payments && payments.length > 0) {
          doc.fontSize(14).text("Payments", { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(10);
          payments.forEach((pay) => {
            doc.text(
              `${pay.receiptNumber || "N/A"} - ${formatDate(pay.receiptDate)} - ${formatCurrency(pay.amount || 0)}`
            );
          });
          doc.moveDown(2);
        }

        // Notes Section
        if (statement.notes) {
          doc.fontSize(14).text("Notes", { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(10).text(statement.notes);
        }

        // Finalize PDF
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  static async sendStatementEmail(to, cc, statement, customer, pdfBuffer) {
    const sgMail = require("@sendgrid/mail");
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error("SendGrid API key is not configured");
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const customerName = withCustomerName(customer);

    const htmlTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
          <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Transporter.Digital Logo" style="max-width: 150px;">
        </div>
        <div style="background-color: #ffffff; padding: 20px;">
          <h2 style="color: #333; margin-bottom: 20px;">Account Statement</h2>
          <p>Dear ${customerName},</p>
          <p>Please find attached your account statement ${statement.statementNumber}.</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Statement Number:</strong> ${statement.statementNumber}</p>
            <p><strong>Period:</strong> ${new Date(statement.periodStart).toISOString().split("T")[0]} to ${new Date(statement.periodEnd).toISOString().split("T")[0]}</p>
            <p><strong>Closing Balance:</strong> $${parseFloat(statement.closingBalance || 0).toFixed(2)}</p>
          </div>
          <p>Thank you for your business.</p>
        </div>
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
          <p>For any questions about this statement, please contact us at <a href="mailto:support@transporter.digital" style="color: #007bff; text-decoration: none;">support@transporter.digital</a>.</p>
          <p>Best regards,<br/>The Transporter.Digital Team</p>
        </div>
      </div>
    `;

    const mailOptions = {
      to,
      cc: cc && cc.length > 0 ? cc : undefined,
      from: process.env.FROM_EMAIL || "tericalomnick@gmail.com",
      subject: `Statement ${statement.statementNumber} - ${customerName}`,
      html: htmlTemplate,
      attachments: [
        {
          content: pdfBuffer.toString("base64"),
          filename: `statement-${statement.statementNumber}.pdf`,
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    };

    await sgMail.send(mailOptions);
  }

  static async createStatement(data, user) {
    const orgId = normalizeOrgId(data.organizationId, user.activeOrganizationId);

    // Validation
    if (!data.customerId) {
      throw new AppError("Customer ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!mongoose.Types.ObjectId.isValid(data.customerId)) {
      throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.fromDate)) {
      throw new AppError(
        "From date is required and must be in YYYY-MM-DD format",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!data.toDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.toDate)) {
      throw new AppError(
        "To date is required and must be in YYYY-MM-DD format",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const fromDate = new Date(`${data.fromDate}T00:00:00.000Z`);
    const toDate = new Date(`${data.toDate}T23:59:59.999Z`);

    if (fromDate > toDate) {
      throw new AppError(
        "To date must be after or equal to from date",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (data.sendViaEmail) {
      if (!data.emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.emailAddress)) {
        throw new AppError(
          "Valid email address is required when sending via email",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Validate CC emails if provided
      if (data.ccEmails && Array.isArray(data.ccEmails)) {
        for (const email of data.ccEmails) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new AppError(`Invalid CC email address: ${email}`, HttpStatusCodes.BAD_REQUEST);
          }
        }
      }
    }

    // Verify customer exists
    const customer = await Customer.findById(data.customerId)
      .populate("partyId", "companyName firstName lastName email")
      .lean();

    if (!customer) {
      throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
    }

    // Calculate opening balance (outstanding invoices before fromDate)
    const openingInvoices = await Invoice.find({
      customerId: new mongoose.Types.ObjectId(data.customerId),
      organizationId: orgId,
      issueDate: { $lt: fromDate },
      status: { $in: ["SENT", "PARTIAL", "OVERDUE"] },
    }).select("balanceDue").lean();

    const openingBalance = openingInvoices.reduce(
      (sum, inv) => sum + Number(inv.balanceDue || 0),
      0
    );

    // Calculate total invoiced (invoices within date range)
    const periodInvoices = await Invoice.find({
      customerId: new mongoose.Types.ObjectId(data.customerId),
      organizationId: orgId,
      issueDate: { $gte: fromDate, $lte: toDate },
      status: { $ne: "DRAFT" },
    }).select("totalIncGst issueDate invoiceNo").lean();

    const totalInvoiced = periodInvoices.reduce(
      (sum, inv) => sum + Number(inv.totalIncGst || 0),
      0
    );

    // Calculate total paid (payments within date range)
    const periodPayments = await Receipt.find({
      customerId: new mongoose.Types.ObjectId(data.customerId),
      organizationId: orgId,
      receiptDate: { $gte: fromDate, $lte: toDate },
    }).select("amount receiptDate receiptNumber").lean();

    const totalPaid = periodPayments.reduce((sum, pay) => sum + Number(pay.amount || 0), 0);

    // Calculate closing balance
    const closingBalance = openingBalance + totalInvoiced - totalPaid;

    // Generate statement number
    const statementNumber = await ReceivablesService.generateStatementNumber(orgId);

    // Create statement record
    const statement = await Statement.create({
      statementNumber,
      customerId: new mongoose.Types.ObjectId(data.customerId),
      statementDate: new Date(),
      periodStart: fromDate,
      periodEnd: toDate,
      openingBalance,
      closingBalance,
      totalInvoiced,
      totalPaid,
      status: "CREATED",
      sentTo: data.sendViaEmail ? data.emailAddress : null,
      ccEmails: data.sendViaEmail && data.ccEmails ? data.ccEmails : [],
      notes: data.notes || null,
      organizationId: orgId,
      createdBy: new mongoose.Types.ObjectId(user._id),
    });

    // Generate PDF
    let pdfBuffer = null;
    let pdfUrl = null;
    try {
      pdfBuffer = await ReceivablesService.generateStatementPDF(
        statement,
        customer,
        periodInvoices,
        periodPayments
      );

      // In a real implementation, upload PDF to S3 or storage service
      // For now, we'll set a placeholder URL
      pdfUrl = `${process.env.API_URL || "https://api.example.com"}/statements/${statement._id}.pdf`;

      // Update statement with PDF URL
      statement.pdfUrl = pdfUrl;
      await statement.save();
    } catch (pdfError) {
      console.error("Failed to generate PDF:", pdfError);
      // Continue without PDF
    }

    // Send email if requested
    if (data.sendViaEmail && pdfBuffer) {
      try {
        await ReceivablesService.sendStatementEmail(
          data.emailAddress,
          data.ccEmails || [],
          statement,
          customer,
          pdfBuffer
        );

        // Update status to SENT
        statement.status = "Sent";
        statement.sentAt = new Date();
        await statement.save();
      } catch (emailError) {
        console.error("Failed to send statement email:", emailError);
        // Keep status as CREATED if email fails, but don't fail the request
        // The statement is still created successfully
      }
    }

    // Populate customer for response
    await statement.populate({
      path: "customerId",
      populate: {
        path: "partyId",
        select: "companyName firstName lastName",
      },
    });

    const customerName = withCustomerName(statement.customerId);

    return {
      id: statement._id.toString(),
      statementNo: statement.statementNumber,
      customerId: statement.customerId._id.toString(),
      customer: {
        id: statement.customerId._id.toString(),
        name: customerName,
      },
      fromDate: statement.periodStart.toISOString(),
      toDate: statement.periodEnd.toISOString(),
      openingBalance: statement.openingBalance.toFixed(2),
      closingBalance: statement.closingBalance.toFixed(2),
      totalInvoiced: statement.totalInvoiced.toFixed(2),
      totalPaid: statement.totalPaid.toFixed(2),
      status: statement.status,
      sentAt: statement.sentAt ? statement.sentAt.toISOString() : null,
      sentTo: statement.sentTo,
      ccEmails: statement.ccEmails || [],
      notes: statement.notes,
      createdAt: statement.createdAt.toISOString(),
      createdBy: statement.createdBy.toString(),
      pdfUrl: statement.pdfUrl,
    };
  }

  static calculateNextScheduledDate(frequency, dayOfMonth, lastSent) {
    if (frequency === "Manual") {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (frequency === "Monthly") {
      const day = dayOfMonth || 1;
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, day);
      // Handle months with fewer days
      if (nextMonth.getDate() !== day) {
        // Use last day of month
        nextMonth.setDate(0);
      }
      return nextMonth;
    } else if (frequency === "Fortnightly") {
      const baseDate = lastSent ? new Date(lastSent) : today;
      const nextDate = new Date(baseDate);
      nextDate.setDate(nextDate.getDate() + 14);
      return nextDate;
    } else if (frequency === "Weekly") {
      const baseDate = lastSent ? new Date(lastSent) : today;
      const nextDate = new Date(baseDate);
      nextDate.setDate(nextDate.getDate() + 7);
      return nextDate;
    }

    return null;
  }

  static async getSchedules(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const status = query.status || null;
    const customer = query.customer || null;
    const frequency = query.frequency || null;
    const search = query.search ? query.search.trim() : null;

    // Build match filter
    const match = {
      organizationId: orgId,
    };

    // Add status filter (map Active/Paused to isActive)
    if (status) {
      match.isActive = status === "Active";
    }

    // Add frequency filter
    if (frequency) {
      match.frequency = frequency;
    }

    // Add customer filter
    if (customer) {
      if (mongoose.Types.ObjectId.isValid(customer)) {
        match.customerId = new mongoose.Types.ObjectId(customer);
      }
      // Will filter by name after population
    }

    // Fetch schedules with populated customer
    let schedules = await StatementSchedule.find(match)
      .populate({
        path: "customerId",
        select: "tradingName legalCompanyName partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ createdAt: -1 })
      .lean();

    // Apply customer name filter if needed
    if (customer && !mongoose.Types.ObjectId.isValid(customer)) {
      const customerLower = customer.toLowerCase();
      schedules = schedules.filter((schedule) => {
        const customerName = withCustomerName(schedule.customerId);
        return customerName.toLowerCase().includes(customerLower);
      });
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      schedules = schedules.filter((schedule) => {
        const customerName = withCustomerName(schedule.customerId);
        const email = schedule.email || "";
        return (
          customerName.toLowerCase().includes(searchLower) ||
          email.toLowerCase().includes(searchLower)
        );
      });
    }

    // Sort by customer name
    schedules.sort((a, b) => {
      const nameA = withCustomerName(a.customerId);
      const nameB = withCustomerName(b.customerId);
      return nameA.localeCompare(nameB);
    });

    // Apply pagination
    const paginatedSchedules = schedules.slice(offset, offset + limit);

    // Format response
    return paginatedSchedules.map((schedule) => {
      const customer = schedule.customerId;
      const customerName = withCustomerName(customer);
      const customerId = customer?._id || customer;

      // Format ccEmails array to comma-separated string
      const ccEmailsStr =
        schedule.ccEmails && schedule.ccEmails.length > 0
          ? schedule.ccEmails.join(", ")
          : null;

      // Format nextScheduled
      let nextScheduled = null;
      if (schedule.frequency === "Manual") {
        nextScheduled = "Manual";
      } else if (schedule.nextScheduled) {
        nextScheduled = schedule.nextScheduled.toISOString().split("T")[0];
      }

      return {
        id: schedule._id.toString(),
        customer: customerName,
        customerId: customerId ? customerId.toString() : null,
        frequency: schedule.frequency,
        email: schedule.email,
        ccEmails: ccEmailsStr,
        dayOfMonth: schedule.dayOfMonth || null,
        lastSent: schedule.lastSent ? schedule.lastSent.toISOString() : null,
        nextScheduled,
        status: schedule.isActive ? "Active" : "Paused",
        active: schedule.isActive,
        notes: null, // Notes field not in model
      };
    });
  }

  static async createSchedule(data, user) {
    const orgId = normalizeOrgId(data.organizationId, user.activeOrganizationId);

    // Validation
    if (!data.customerId && !data.customer) {
      throw new AppError("Customer is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.frequency) {
      throw new AppError("Frequency is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!["Monthly", "Fortnightly", "Weekly", "Manual"].includes(data.frequency)) {
      throw new AppError(
        "Frequency must be one of: Monthly, Fortnightly, Weekly, Manual",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (!data.email) {
      throw new AppError("Email is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      throw new AppError("Invalid email address format", HttpStatusCodes.BAD_REQUEST);
    }

    // Validate dayOfMonth for Monthly frequency
    if (data.frequency === "Monthly" && data.dayOfMonth) {
      if (data.dayOfMonth < 1 || data.dayOfMonth > 28) {
        throw new AppError("Day of month must be between 1 and 28", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Get customer ID
    let customerId = data.customerId;
    if (!customerId && data.customer) {
      // Try to find customer by name
      const customer = await Customer.findOne({
        organizationId: orgId,
        $or: [
          { tradingName: data.customer },
          { legalCompanyName: data.customer },
        ],
      }).lean();

      if (!customer) {
        throw new AppError("Customer not found. Please provide a valid customer ID.", HttpStatusCodes.BAD_REQUEST);
      }
      customerId = customer._id;
    }

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      throw new AppError("Invalid customer ID", HttpStatusCodes.BAD_REQUEST);
    }

    // Check if schedule already exists for this customer
    const existing = await StatementSchedule.findOne({
      organizationId: orgId,
      customerId: new mongoose.Types.ObjectId(customerId),
    }).lean();

    if (existing) {
      throw new AppError(
        "A schedule already exists for this customer",
        HttpStatusCodes.CONFLICT
      );
    }

    // Get customer name
    const customer = await Customer.findById(customerId)
      .populate("partyId", "companyName firstName lastName")
      .lean();
    const customerName = withCustomerName(customer);

    // Calculate next scheduled date
    const nextScheduled = ReceivablesService.calculateNextScheduledDate(
      data.frequency,
      data.dayOfMonth,
      null
    );

    // Convert ccEmails string to array
    let ccEmailsArray = [];
    if (data.ccEmails) {
      ccEmailsArray = data.ccEmails
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.length > 0);
    }

    // Map status to isActive
    const isActive = data.status === "Paused" ? false : data.active !== false;

    // Create schedule
    const schedule = await StatementSchedule.create({
      customerId: new mongoose.Types.ObjectId(customerId),
      frequency: data.frequency,
      dayOfMonth: data.dayOfMonth || null,
      email: data.email.toLowerCase().trim(),
      ccEmails: ccEmailsArray,
      isActive,
      lastSent: null,
      nextScheduled,
      organizationId: orgId,
    });

    // Format response
    const ccEmailsStr =
      schedule.ccEmails && schedule.ccEmails.length > 0
        ? schedule.ccEmails.join(", ")
        : null;

    let nextScheduledStr = null;
    if (schedule.frequency === "Manual") {
      nextScheduledStr = "Manual";
    } else if (schedule.nextScheduled) {
      nextScheduledStr = schedule.nextScheduled.toISOString().split("T")[0];
    }

    return {
      id: schedule._id.toString(),
      customer: customerName,
      customerId: customerId.toString(),
      frequency: schedule.frequency,
      email: schedule.email,
      ccEmails: ccEmailsStr,
      dayOfMonth: schedule.dayOfMonth || null,
      lastSent: null,
      nextScheduled: nextScheduledStr,
      status: schedule.isActive ? "Active" : "Paused",
      active: schedule.isActive,
      notes: null,
    };
  }

  static async updateSchedule(scheduleId, data, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    // Find schedule
    const schedule = await StatementSchedule.findOne({
      _id: new mongoose.Types.ObjectId(scheduleId),
      organizationId: orgId,
    });

    if (!schedule) {
      throw new AppError("Schedule not found", HttpStatusCodes.NOT_FOUND);
    }

    // Validate frequency if provided
    if (data.frequency && !["Monthly", "Fortnightly", "Weekly", "Manual"].includes(data.frequency)) {
      throw new AppError(
        "Frequency must be one of: Monthly, Fortnightly, Weekly, Manual",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate email format if provided
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new AppError("Invalid email address format", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Validate dayOfMonth if provided
    if (data.dayOfMonth !== undefined) {
      if (data.dayOfMonth !== null && (data.dayOfMonth < 1 || data.dayOfMonth > 28)) {
        throw new AppError("Day of month must be between 1 and 28", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Update fields
    if (data.frequency !== undefined) {
      schedule.frequency = data.frequency;
      // Recalculate next scheduled date if frequency changed
      schedule.nextScheduled = ReceivablesService.calculateNextScheduledDate(
        data.frequency,
        data.dayOfMonth !== undefined ? data.dayOfMonth : schedule.dayOfMonth,
        schedule.lastSent
      );
    }

    if (data.email !== undefined) {
      schedule.email = data.email.toLowerCase().trim();
    }

    if (data.ccEmails !== undefined) {
      if (data.ccEmails === null || data.ccEmails === "") {
        schedule.ccEmails = [];
      } else {
        schedule.ccEmails = data.ccEmails
          .split(",")
          .map((email) => email.trim())
          .filter((email) => email.length > 0);
      }
    }

    if (data.dayOfMonth !== undefined) {
      schedule.dayOfMonth = data.dayOfMonth || null;
      // Recalculate next scheduled if it's Monthly
      if (schedule.frequency === "Monthly") {
        schedule.nextScheduled = ReceivablesService.calculateNextScheduledDate(
          schedule.frequency,
          schedule.dayOfMonth,
          schedule.lastSent
        );
      }
    }

    if (data.status !== undefined) {
      schedule.isActive = data.status === "Active";
    }

    if (data.active !== undefined) {
      schedule.isActive = data.active;
    }

    await schedule.save();

    // Populate customer for response
    await schedule.populate({
      path: "customerId",
      select: "tradingName legalCompanyName partyId",
      populate: {
        path: "partyId",
        select: "companyName firstName lastName",
      },
    });

    const customerName = withCustomerName(schedule.customerId);

    // Format response
    const ccEmailsStr =
      schedule.ccEmails && schedule.ccEmails.length > 0
        ? schedule.ccEmails.join(", ")
        : null;

    let nextScheduledStr = null;
    if (schedule.frequency === "Manual") {
      nextScheduledStr = "Manual";
    } else if (schedule.nextScheduled) {
      nextScheduledStr = schedule.nextScheduled.toISOString().split("T")[0];
    }

    return {
      id: schedule._id.toString(),
      customer: customerName,
      customerId: schedule.customerId._id.toString(),
      frequency: schedule.frequency,
      email: schedule.email,
      ccEmails: ccEmailsStr,
      dayOfMonth: schedule.dayOfMonth || null,
      lastSent: schedule.lastSent ? schedule.lastSent.toISOString() : null,
      nextScheduled: nextScheduledStr,
      status: schedule.isActive ? "Active" : "Paused",
      active: schedule.isActive,
      notes: null,
    };
  }

  static async deleteSchedule(scheduleId, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    const schedule = await StatementSchedule.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(scheduleId),
      organizationId: orgId,
    });

    if (!schedule) {
      throw new AppError("Schedule not found", HttpStatusCodes.NOT_FOUND);
    }

    return { message: "Schedule deleted successfully" };
  }

  static calculateActivityStatus(balanceDue, dueDate, paidDate) {
    if (paidDate || balanceDue === 0) {
      return "Paid";
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((due - today) / (1000 * 60 * 60 * 24));

    if (daysDiff >= 0 && daysDiff <= 3) {
      return "Expected";
    }

    return "Pending";
  }

  static calculateExpectedDate(dueDate, status) {
    if (status !== "Expected") {
      return null;
    }

    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const expected = new Date(due);
    expected.setDate(expected.getDate() - 2); // 2 days before due date

    return expected;
  }

  static async getCustomerActivity(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const type = query.type && query.type !== "ALL" ? query.type : null;
    const customerId = query.customerId && query.customerId !== "ALL" ? query.customerId : null;
    const status = query.status && query.status !== "ALL" ? query.status : null;
    const search = query.search ? query.search.trim() : null;

    // Build match filter for invoices
    const match = {
      organizationId: orgId,
      status: { $nin: ["DRAFT", "VOID"] }, // Exclude drafts and voided invoices
    };

    // Filter by customer
    if (customerId) {
      if (mongoose.Types.ObjectId.isValid(customerId)) {
        match.customerId = new mongoose.Types.ObjectId(customerId);
      }
      // Will filter by name after population
    }

    // Fetch invoices
    let invoices = await Invoice.find(match)
      .populate({
        path: "customerId",
        select: "tradingName legalCompanyName partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName",
        },
      })
      .sort({ issueDate: -1, invoiceNo: -1 })
      .lean();

    // Filter by customer name if needed
    if (customerId && !mongoose.Types.ObjectId.isValid(customerId)) {
      const customerLower = customerId.toLowerCase();
      invoices = invoices.filter((inv) => {
        const customerName = withCustomerName(inv.customerId);
        return customerName.toLowerCase().includes(customerLower);
      });
    }

    // Get invoice IDs
    const invoiceIds = invoices.map((inv) => inv._id);

    // Get line items for job dates and descriptions
    const lineItems = await InvoiceLineItem.find({
      invoiceId: { $in: invoiceIds },
    })
      .populate("jobId", "date")
      .lean();

    // Get payments for paid dates
    const payments = await InvoicePayment.find({
      invoiceId: { $in: invoiceIds },
    })
      .select("invoiceId receiptDate")
      .sort({ receiptDate: 1 })
      .lean();

    // Build maps for quick lookup
    const invoiceLineItemsMap = {};
    const invoicePaymentsMap = {};

    lineItems.forEach((item) => {
      if (!invoiceLineItemsMap[item.invoiceId.toString()]) {
        invoiceLineItemsMap[item.invoiceId.toString()] = [];
      }
      invoiceLineItemsMap[item.invoiceId.toString()].push(item);
    });

    payments.forEach((payment) => {
      const invoiceIdStr = payment.invoiceId.toString();
      if (!invoicePaymentsMap[invoiceIdStr]) {
        invoicePaymentsMap[invoiceIdStr] = payment.receiptDate; // Store earliest payment date
      } else {
        // Keep the earliest payment date
        if (payment.receiptDate < invoicePaymentsMap[invoiceIdStr]) {
          invoicePaymentsMap[invoiceIdStr] = payment.receiptDate;
        }
      }
    });

    // Format activities
    let activities = invoices.map((invoice) => {
      const customerName = withCustomerName(invoice.customerId);
      const invoiceIdStr = invoice._id.toString();

      // Get job date from line items (use earliest job date)
      const items = invoiceLineItemsMap[invoiceIdStr] || [];
      let jobDate = null;
      if (items.length > 0) {
        const jobDates = items
          .map((item) => {
            if (item.jobId && item.jobId.date) {
              return new Date(item.jobId.date);
            }
            return null;
          })
          .filter(Boolean)
          .sort((a, b) => a - b);

        if (jobDates.length > 0) {
          jobDate = jobDates[0];
        }
      }

      // Get description from line items (combine all descriptions)
      const descriptions = items
        .map((item) => item.description)
        .filter(Boolean)
        .join(", ");
      const description = descriptions || "No description";

      // Get paid date
      const paidDate = invoicePaymentsMap[invoiceIdStr] || null;

      // Calculate status
      const activityStatus = ReceivablesService.calculateActivityStatus(
        invoice.balanceDue,
        invoice.dueDate,
        paidDate
      );

      // Calculate expected date
      const expectedDate = ReceivablesService.calculateExpectedDate(invoice.dueDate, activityStatus);

      return {
        type: "Invoice",
        number: invoice.invoiceNo,
        customer: customerName,
        description,
        jobDate: jobDate ? jobDate.toISOString() : null,
        invoiceDate: invoice.issueDate ? invoice.issueDate.toISOString() : null,
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
        paidDate: paidDate ? paidDate.toISOString() : null,
        amount: Number(invoice.totalIncGst || 0),
        expectedDate: expectedDate ? expectedDate.toISOString() : undefined,
        status: activityStatus,
        _balanceDue: invoice.balanceDue, // Internal field for filtering
        _dueDate: invoice.dueDate, // Internal field for filtering
      };
    });

    // Apply status filter
    if (status) {
      const statusUpper = status.toUpperCase();
      activities = activities.filter((activity) => {
        const activityStatusUpper = activity.status.toUpperCase();
        return activityStatusUpper === statusUpper;
      });
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      activities = activities.filter((activity) => {
        return (
          activity.number.toLowerCase().includes(searchLower) ||
          activity.customer.toLowerCase().includes(searchLower) ||
          activity.description.toLowerCase().includes(searchLower)
        );
      });
    }

    // Apply type filter (currently only Invoice is supported)
    if (type && type !== "Invoice") {
      activities = activities.filter((activity) => activity.type === type);
    }

    // Apply pagination
    const paginatedActivities = activities.slice(offset, offset + limit);

    // Remove internal fields
    return paginatedActivities.map((activity) => {
      const { _balanceDue, _dueDate, ...rest } = activity;
      return rest;
    });
  }

  static getAgingBucket(dueDate, asOfDate) {
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const asOf = new Date(asOfDate);
    asOf.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((asOf - due) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
      return "current"; // Not yet due
    } else if (daysDiff === 1) {
      return "1"; // Exactly 1 day overdue
    } else if (daysDiff >= 2 && daysDiff <= 7) {
      return "7"; // 1-7 days overdue (excluding 1 day)
    } else if (daysDiff >= 8 && daysDiff <= 14) {
      return "14"; // 8-14 days overdue
    } else if (daysDiff >= 15 && daysDiff <= 21) {
      return "21"; // 15-21 days overdue
    } else if (daysDiff >= 22 && daysDiff <= 30) {
      return "30"; // 22-30 days overdue
    } else if (daysDiff >= 31 && daysDiff <= 60) {
      return "60"; // 31-60 days overdue
    } else {
      return "90"; // 61+ days overdue
    }
  }

  static async getAgingReport(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 10000);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const customer = query.customer || null;
    const search = query.search ? query.search.trim() : null;

    // Parse asOfDate or use today
    let asOfDate = new Date();
    if (query.asOfDate) {
      asOfDate = new Date(query.asOfDate);
    }
    asOfDate.setHours(0, 0, 0, 0);

    // Build match filter for invoices
    const match = {
      organizationId: orgId,
      balanceDue: { $gt: 0 }, // Only outstanding balances
      status: { $nin: ["PAID", "VOID"] }, // Exclude paid and voided
    };

    // Filter by customer
    if (customer) {
      if (mongoose.Types.ObjectId.isValid(customer)) {
        match.customerId = new mongoose.Types.ObjectId(customer);
      }
      // Will filter by name after population
    }

    // Fetch invoices
    let invoices = await Invoice.find(match)
      .populate({
        path: "customerId",
        select: "tradingName legalCompanyName accountsEmail primaryContactEmail partyId",
        populate: {
          path: "partyId",
          select: "companyName firstName lastName email",
        },
      })
      .lean();

    // Filter by customer name if needed
    if (customer && !mongoose.Types.ObjectId.isValid(customer)) {
      const customerLower = customer.toLowerCase();
      invoices = invoices.filter((inv) => {
        const customerName = withCustomerName(inv.customerId);
        return customerName.toLowerCase().includes(customerLower);
      });
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      invoices = invoices.filter((inv) => {
        const customerName = withCustomerName(inv.customerId);
        const customer = inv.customerId;
        const customerEmail =
          customer?.accountsEmail ||
          customer?.primaryContactEmail ||
          customer?.partyId?.email ||
          "";
        return (
          customerName.toLowerCase().includes(searchLower) ||
          customerEmail.toLowerCase().includes(searchLower)
        );
      });
    }

    // Group invoices by customer and calculate buckets
    const customerMap = {};

    invoices.forEach((invoice) => {
      const customer = invoice.customerId;
      const customerName = withCustomerName(customer);
      const customerEmail =
        customer?.accountsEmail ||
        customer?.primaryContactEmail ||
        customer?.partyId?.email ||
        "";
      const customerId = customer?._id?.toString() || customer?.toString() || "";

      // Initialize customer if not exists
      if (!customerMap[customerId]) {
        customerMap[customerId] = {
          customer: customerName,
          email: customerEmail,
          buckets: {
            current: 0,
            "1": 0,
            "7": 0,
            "14": 0,
            "21": 0,
            "30": 0,
            "60": 0,
            "90": 0,
          },
        };
      }

      // Calculate bucket for this invoice
      const bucket = ReceivablesService.getAgingBucket(invoice.dueDate, asOfDate);
      const balance = Number(invoice.balanceDue || 0);

      // Add balance to appropriate bucket
      customerMap[customerId].buckets[bucket] += balance;
    });

    // Convert map to array and filter out customers with zero total
    let customers = Object.values(customerMap).filter((customer) => {
      const total =
        customer.buckets.current +
        customer.buckets["1"] +
        customer.buckets["7"] +
        customer.buckets["14"] +
        customer.buckets["21"] +
        customer.buckets["30"] +
        customer.buckets["60"] +
        customer.buckets["90"];
      return total > 0;
    });

    // Sort by customer name
    customers.sort((a, b) => a.customer.localeCompare(b.customer));

    // Apply pagination
    const paginatedCustomers = customers.slice(offset, offset + limit);

    // Format response
    return paginatedCustomers.map((customer) => ({
      customer: customer.customer,
      email: customer.email || "",
      buckets: {
        current: Number(customer.buckets.current.toFixed(2)),
        "1": Number(customer.buckets["1"].toFixed(2)),
        "7": Number(customer.buckets["7"].toFixed(2)),
        "14": Number(customer.buckets["14"].toFixed(2)),
        "21": Number(customer.buckets["21"].toFixed(2)),
        "30": Number(customer.buckets["30"].toFixed(2)),
        "60": Number(customer.buckets["60"].toFixed(2)),
        "90": Number(customer.buckets["90"].toFixed(2)),
      },
    }));
  }
}

module.exports = ReceivablesService;
