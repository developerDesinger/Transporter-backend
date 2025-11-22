const mongoose = require("mongoose");
const Adjustment = require("../models/adjustment.model");
const AdjustmentApplication = require("../models/adjustmentApplication.model");
const Customer = require("../models/customer.model");
const Driver = require("../models/driver.model");
const Invoice = require("../models/invoice.model");
const PayRun = require("../models/payRun.model");
const Job = require("../models/job.model");
const User = require("../models/user.model");
const Party = require("../models/party.model");
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

const getEntityName = async (entityType, entityId) => {
  if (entityType === "Customer") {
    const customer = await Customer.findById(entityId)
      .populate("partyId", "companyName firstName lastName")
      .lean();
    if (!customer) return "Unknown";
    if (customer.tradingName) return customer.tradingName;
    if (customer.legalCompanyName) return customer.legalCompanyName;
    const party = customer.partyId;
    if (!party) return "Unknown";
    if (party.companyName) return party.companyName;
    return [party.firstName, party.lastName].filter(Boolean).join(" ").trim() || "Unknown";
  } else if (entityType === "Driver") {
    const driver = await Driver.findById(entityId).populate("partyId", "firstName lastName").lean();
    if (!driver) return "Unknown";
    const party = driver.partyId;
    if (!party) return "Unknown";
    return [party.firstName, party.lastName].filter(Boolean).join(" ").trim() || "Unknown";
  }
  return "Unknown";
};

const getUserName = (user) => {
  if (!user) return "Unknown";
  return user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown";
};

class AdjustmentService {
  static async getSummary(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);

    const match = {
      organizationId: orgId,
      deletedAt: null,
    };

    const [summary] = await Adjustment.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCredits: {
            $sum: {
              $cond: [{ $eq: ["$adjustmentType", "Credit"] }, "$amountIncludingGst", 0],
            },
          },
          totalCharges: {
            $sum: {
              $cond: [{ $eq: ["$adjustmentType", "Charge"] }, "$amountIncludingGst", 0],
            },
          },
          creditCount: {
            $sum: {
              $cond: [{ $eq: ["$adjustmentType", "Credit"] }, 1, 0],
            },
          },
          chargeCount: {
            $sum: {
              $cond: [{ $eq: ["$adjustmentType", "Charge"] }, 1, 0],
            },
          },
          pendingApproval: {
            $sum: {
              $cond: [{ $eq: ["$status", "Pending Approval"] }, 1, 0],
            },
          },
          applied: {
            $sum: {
              $cond: [{ $eq: ["$status", "Applied"] }, 1, 0],
            },
          },
          draft: {
            $sum: {
              $cond: [{ $eq: ["$status", "Draft"] }, 1, 0],
            },
          },
          sent: {
            $sum: {
              $cond: [{ $eq: ["$status", "Sent"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return {
      totalCredits: summary?.totalCredits || 0,
      totalCharges: summary?.totalCharges || 0,
      creditCount: summary?.creditCount || 0,
      chargeCount: summary?.chargeCount || 0,
      pendingApproval: summary?.pendingApproval || 0,
      applied: summary?.applied || 0,
      draft: summary?.draft || 0,
      sent: summary?.sent || 0,
    };
  }

  static async getAdjustments(query, user) {
    const orgId = normalizeOrgId(query.organizationId, user.activeOrganizationId);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const match = {
      organizationId: orgId,
      deletedAt: null,
    };

    // Status filter
    if (query.status) {
      match.status = query.status;
    }

    // Type filter
    if (query.type) {
      match.adjustmentType = query.type;
    }

    // Entity type filter
    if (query.entityType) {
      match.entityType = query.entityType;
    }

    // Search filter - will be applied after fetching to include entity names
    const searchTerm = query.search ? query.search.trim() : null;

    // Sort
    const sortBy = query.sortBy || "createdAt";
    const sortOrder = query.sortOrder === "asc" ? 1 : -1;
    const sort = { [sortBy]: sortOrder };

    // If search is provided, we need to fetch all and filter by entity name
    // Otherwise, we can use database-level filtering
    let adjustments;
    let total;

    if (searchTerm) {
      // Fetch all matching adjustments (without search on entity name)
      const allAdjustments = await Adjustment.find(match).sort(sort).lean();

      // Get entity names and filter
      const adjustmentsWithNames = await Promise.all(
        allAdjustments.map(async (adj) => {
          const entityName = await getEntityName(adj.entityType, adj.entityId);
          return { ...adj, entityName };
        })
      );

      // Apply search filter
      const searchLower = searchTerm.toLowerCase();
      const filteredAdjustments = adjustmentsWithNames.filter((adj) => {
        return (
          adj.adjustmentNumber.toLowerCase().includes(searchLower) ||
          adj.entityName.toLowerCase().includes(searchLower) ||
          adj.description.toLowerCase().includes(searchLower)
        );
      });

      total = filteredAdjustments.length;
      adjustments = filteredAdjustments.slice(skip, skip + limit);
    } else {
      // Fetch with pagination
      [adjustments, total] = await Promise.all([
        Adjustment.find(match).sort(sort).skip(skip).limit(limit).lean(),
        Adjustment.countDocuments(match),
      ]);
    }

    // Get entity names and creator names
    const formattedAdjustments = await Promise.all(
      adjustments.map(async (adj) => {
        const entityName = adj.entityName || (await getEntityName(adj.entityType, adj.entityId));
        const creator = await User.findById(adj.createdBy).lean();
        const creatorName = getUserName(creator);

        return {
          id: adj._id.toString(),
          adjustmentNumber: adj.adjustmentNumber,
          entityId: adj.entityId.toString(),
          entityName,
          entityType: adj.entityType,
          type: adj.adjustmentType,
          description: adj.description,
          amount: adj.amount,
          amountIncludingGst: adj.amountIncludingGst,
          category: adj.category,
          status: adj.status,
          applyAfterDate: adj.applyAfterDate ? adj.applyAfterDate.toISOString() : null,
          autoApply: adj.autoApply,
          requiresApproval: adj.requiresApproval,
          relatedInvoiceNumber: adj.relatedInvoiceNumber,
          relatedPayRunNumber: adj.relatedPayRunNumber,
          relatedJobNumbers: adj.relatedJobNumbers || [],
          createdAt: adj.createdAt.toISOString(),
          createdBy: creatorName,
          createdById: adj.createdBy.toString(),
        };
      })
    );

    return {
      data: formattedAdjustments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  static async generateAdjustmentNumber(organizationId) {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
    const prefix = `ADJ-${dateStr}-`;

    const query = {
      adjustmentNumber: new RegExp(`^${prefix}`),
    };

    if (organizationId) {
      query.organizationId = new mongoose.Types.ObjectId(organizationId);
    } else {
      query.organizationId = null;
    }

    const lastAdjustment = await Adjustment.findOne(query).sort({ adjustmentNumber: -1 }).lean();

    let sequence = 1;
    if (lastAdjustment && lastAdjustment.adjustmentNumber) {
      const parts = lastAdjustment.adjustmentNumber.split("-");
      if (parts.length >= 3) {
        const lastSequence = parseInt(parts[2], 10);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      }
    }

    // Ensure uniqueness
    let attempts = 0;
    let adjustmentNumber;
    let exists = true;

    while (exists && attempts < 10) {
      adjustmentNumber = `${prefix}${String(sequence).padStart(3, "0")}`;

      const existingAdjustment = await Adjustment.findOne({
        adjustmentNumber,
        organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : null,
      });

      if (!existingAdjustment) {
        exists = false;
      } else {
        sequence++;
        attempts++;
      }
    }

    if (exists) {
      throw new AppError(
        "Unable to generate unique adjustment number",
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    return adjustmentNumber;
  }

  static async createAdjustment(data, user) {
    const orgId = normalizeOrgId(data.organizationId, user.activeOrganizationId);

    // Validation
    if (!data.entityType || !["Customer", "Driver"].includes(data.entityType)) {
      throw new AppError("Entity type must be Customer or Driver", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.entityId || !mongoose.Types.ObjectId.isValid(data.entityId)) {
      throw new AppError("Valid entity ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.adjustmentType || !["Credit", "Charge"].includes(data.adjustmentType)) {
      throw new AppError("Adjustment type must be Credit or Charge", HttpStatusCodes.BAD_REQUEST);
    }

    const amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new AppError("Amount must be greater than 0", HttpStatusCodes.BAD_REQUEST);
    }

    const validCategories = ["Goodwill", "Missed Charge", "Service Issue", "Pricing Error", "Other"];
    if (!data.category || !validCategories.includes(data.category)) {
      throw new AppError(`Category must be one of: ${validCategories.join(", ")}`, HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.description || !data.description.trim()) {
      throw new AppError("Description is required", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.notesForRecipient || !data.notesForRecipient.trim()) {
      throw new AppError("Notes for recipient is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify entity exists
    if (data.entityType === "Customer") {
      const customer = await Customer.findById(data.entityId).lean();
      if (!customer) {
        throw new AppError("Customer not found", HttpStatusCodes.NOT_FOUND);
      }
    } else if (data.entityType === "Driver") {
      const driver = await Driver.findById(data.entityId).lean();
      if (!driver) {
        throw new AppError("Driver not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    // Validate related documents
    if (data.relatedInvoiceNumber) {
      const invoice = await Invoice.findOne({
        invoiceNo: data.relatedInvoiceNumber,
        organizationId: orgId,
      }).lean();
      if (!invoice) {
        throw new AppError("Related invoice not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    if (data.relatedPayRunNumber) {
      const payRun = await PayRun.findOne({
        payRunNumber: data.relatedPayRunNumber,
        organizationId: orgId,
      }).lean();
      if (!payRun) {
        throw new AppError("Related pay run not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    if (data.relatedJobNumbers && Array.isArray(data.relatedJobNumbers)) {
      for (const jobNumber of data.relatedJobNumbers) {
        const job = await Job.findOne({
          jobNumber,
          organizationId: orgId,
        }).lean();
        if (!job) {
          throw new AppError(`Related job not found: ${jobNumber}`, HttpStatusCodes.NOT_FOUND);
        }
      }
    }

    // Calculate GST (10% in Australia)
    const gstAmount = amount * 0.1;
    const amountIncludingGst = amount + gstAmount;

    // Generate adjustment number
    const adjustmentNumber = await AdjustmentService.generateAdjustmentNumber(orgId);

    // Determine initial status
    let status = "Draft";
    if (data.requiresApproval) {
      status = "Pending Approval";
    }

    // Parse applyAfterDate if provided
    let applyAfterDate = null;
    if (data.applyAfterDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.applyAfterDate)) {
        throw new AppError("Apply after date must be in YYYY-MM-DD format", HttpStatusCodes.BAD_REQUEST);
      }
      applyAfterDate = new Date(`${data.applyAfterDate}T00:00:00.000Z`);
    }

    // Create adjustment
    const adjustment = await Adjustment.create({
      adjustmentNumber,
      entityType: data.entityType,
      entityId: new mongoose.Types.ObjectId(data.entityId),
      adjustmentType: data.adjustmentType,
      amount,
      amountIncludingGst,
      gstAmount,
      category: data.category,
      description: data.description.trim(),
      notesForRecipient: data.notesForRecipient.trim(),
      internalNotes: data.internalNotes ? data.internalNotes.trim() : null,
      status,
      applyAfterDate,
      autoApply: data.autoApply || false,
      requiresApproval: data.requiresApproval || false,
      relatedInvoiceNumber: data.relatedInvoiceNumber || null,
      relatedPayRunNumber: data.relatedPayRunNumber || null,
      relatedJobNumbers: data.relatedJobNumbers || [],
      createdBy: new mongoose.Types.ObjectId(user._id),
      organizationId: orgId,
    });

    // Get entity name and creator name
    const entityName = await getEntityName(adjustment.entityType, adjustment.entityId);
    const creator = await User.findById(adjustment.createdBy).lean();
    const creatorName = getUserName(creator);

    return {
      id: adjustment._id.toString(),
      adjustmentNumber: adjustment.adjustmentNumber,
      entityId: adjustment.entityId.toString(),
      entityName,
      entityType: adjustment.entityType,
      type: adjustment.adjustmentType,
      description: adjustment.description,
      amount: adjustment.amount,
      amountIncludingGst: adjustment.amountIncludingGst,
      category: adjustment.category,
      status: adjustment.status,
      applyAfterDate: adjustment.applyAfterDate ? adjustment.applyAfterDate.toISOString() : null,
      autoApply: adjustment.autoApply,
      requiresApproval: adjustment.requiresApproval,
      relatedInvoiceNumber: adjustment.relatedInvoiceNumber,
      relatedPayRunNumber: adjustment.relatedPayRunNumber,
      relatedJobNumbers: adjustment.relatedJobNumbers || [],
      createdAt: adjustment.createdAt.toISOString(),
      createdBy: creatorName,
    };
  }

  static async getAdjustmentDetails(adjustmentId, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    }).lean();

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get entity name
    const entityName = await getEntityName(adjustment.entityType, adjustment.entityId);

    // Get creator
    const creator = await User.findById(adjustment.createdBy).lean();
    const creatorName = getUserName(creator);

    // Get approver if exists
    let approvedByName = null;
    if (adjustment.approvedBy) {
      const approver = await User.findById(adjustment.approvedBy).lean();
      approvedByName = getUserName(approver);
    }

    // Get application history
    const applications = await AdjustmentApplication.find({
      adjustmentId: adjustment._id,
    })
      .populate("appliedBy", "name firstName lastName")
      .sort({ createdAt: -1 })
      .lean();

    const applicationHistory = applications.map((app) => ({
      id: app._id.toString(),
      appliedToType: app.appliedToType,
      appliedToId: app.appliedToId.toString(),
      appliedAmount: app.appliedAmount,
      appliedAt: app.appliedAt.toISOString(),
      appliedBy: getUserName(app.appliedBy),
    }));

    return {
      id: adjustment._id.toString(),
      adjustmentNumber: adjustment.adjustmentNumber,
      entityId: adjustment.entityId.toString(),
      entityName,
      entityType: adjustment.entityType,
      type: adjustment.adjustmentType,
      description: adjustment.description,
      amount: adjustment.amount,
      gstAmount: adjustment.gstAmount,
      amountIncludingGst: adjustment.amountIncludingGst,
      category: adjustment.category,
      status: adjustment.status,
      notesForRecipient: adjustment.notesForRecipient,
      internalNotes: adjustment.internalNotes,
      applyAfterDate: adjustment.applyAfterDate ? adjustment.applyAfterDate.toISOString() : null,
      autoApply: adjustment.autoApply,
      requiresApproval: adjustment.requiresApproval,
      approvedBy: approvedByName,
      approvedAt: adjustment.approvedAt ? adjustment.approvedAt.toISOString() : null,
      relatedInvoiceNumber: adjustment.relatedInvoiceNumber,
      relatedPayRunNumber: adjustment.relatedPayRunNumber,
      relatedJobNumbers: adjustment.relatedJobNumbers || [],
      appliedToInvoiceId: adjustment.appliedToInvoiceId ? adjustment.appliedToInvoiceId.toString() : null,
      appliedToPayRunId: adjustment.appliedToPayRunId ? adjustment.appliedToPayRunId.toString() : null,
      appliedAt: adjustment.appliedAt ? adjustment.appliedAt.toISOString() : null,
      createdAt: adjustment.createdAt.toISOString(),
      createdBy: creatorName,
      createdById: adjustment.createdBy.toString(),
      updatedAt: adjustment.updatedAt.toISOString(),
      applicationHistory,
    };
  }

  static async updateAdjustment(adjustmentId, data, user) {
    const orgId = normalizeOrgId(data.organizationId, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    });

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Cannot update if status is Sent, Approved, or Applied
    if (["Sent", "Approved", "Applied"].includes(adjustment.status)) {
      throw new AppError(
        `Adjustment cannot be updated. Current status: ${adjustment.status}`,
        HttpStatusCodes.CONFLICT
      );
    }

    // Cannot change entityType or entityId if already sent
    if (adjustment.status === "Sent" && (data.entityType || data.entityId)) {
      throw new AppError(
        "Cannot change entity type or entity ID for sent adjustments",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update fields
    if (data.amount !== undefined) {
      const amount = parseFloat(data.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new AppError("Amount must be greater than 0", HttpStatusCodes.BAD_REQUEST);
      }
      adjustment.amount = amount;
      // Recalculate GST
      adjustment.gstAmount = amount * 0.1;
      adjustment.amountIncludingGst = amount + adjustment.gstAmount;
    }

    if (data.category !== undefined) {
      const validCategories = ["Goodwill", "Missed Charge", "Service Issue", "Pricing Error", "Other"];
      if (!validCategories.includes(data.category)) {
        throw new AppError(`Category must be one of: ${validCategories.join(", ")}`, HttpStatusCodes.BAD_REQUEST);
      }
      adjustment.category = data.category;
    }

    if (data.description !== undefined) {
      if (!data.description.trim()) {
        throw new AppError("Description is required", HttpStatusCodes.BAD_REQUEST);
      }
      adjustment.description = data.description.trim();
    }

    if (data.notesForRecipient !== undefined) {
      if (!data.notesForRecipient.trim()) {
        throw new AppError("Notes for recipient is required", HttpStatusCodes.BAD_REQUEST);
      }
      adjustment.notesForRecipient = data.notesForRecipient.trim();
    }

    if (data.internalNotes !== undefined) {
      adjustment.internalNotes = data.internalNotes ? data.internalNotes.trim() : null;
    }

    if (data.applyAfterDate !== undefined) {
      if (data.applyAfterDate === null) {
        adjustment.applyAfterDate = null;
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.applyAfterDate)) {
          throw new AppError("Apply after date must be in YYYY-MM-DD format", HttpStatusCodes.BAD_REQUEST);
        }
        adjustment.applyAfterDate = new Date(`${data.applyAfterDate}T00:00:00.000Z`);
      }
    }

    if (data.autoApply !== undefined) {
      adjustment.autoApply = data.autoApply;
    }

    if (data.requiresApproval !== undefined) {
      adjustment.requiresApproval = data.requiresApproval;
      // Update status if requiresApproval changed
      if (data.requiresApproval && adjustment.status === "Draft") {
        adjustment.status = "Pending Approval";
      } else if (!data.requiresApproval && adjustment.status === "Pending Approval") {
        adjustment.status = "Draft";
      }
    }

    if (data.relatedInvoiceNumber !== undefined) {
      if (data.relatedInvoiceNumber) {
        const invoice = await Invoice.findOne({
          invoiceNo: data.relatedInvoiceNumber,
          organizationId: orgId,
        }).lean();
        if (!invoice) {
          throw new AppError("Related invoice not found", HttpStatusCodes.NOT_FOUND);
        }
      }
      adjustment.relatedInvoiceNumber = data.relatedInvoiceNumber || null;
    }

    if (data.relatedPayRunNumber !== undefined) {
      if (data.relatedPayRunNumber) {
        const payRun = await PayRun.findOne({
          payRunNumber: data.relatedPayRunNumber,
          organizationId: orgId,
        }).lean();
        if (!payRun) {
          throw new AppError("Related pay run not found", HttpStatusCodes.NOT_FOUND);
        }
      }
      adjustment.relatedPayRunNumber = data.relatedPayRunNumber || null;
    }

    if (data.relatedJobNumbers !== undefined) {
      if (Array.isArray(data.relatedJobNumbers)) {
        for (const jobNumber of data.relatedJobNumbers) {
          const job = await Job.findOne({
            jobNumber,
            organizationId: orgId,
          }).lean();
          if (!job) {
            throw new AppError(`Related job not found: ${jobNumber}`, HttpStatusCodes.NOT_FOUND);
          }
        }
      }
      adjustment.relatedJobNumbers = data.relatedJobNumbers || [];
    }

    await adjustment.save();

    // Get entity name and creator name
    const entityName = await getEntityName(adjustment.entityType, adjustment.entityId);
    const creator = await User.findById(adjustment.createdBy).lean();
    const creatorName = getUserName(creator);

    return {
      id: adjustment._id.toString(),
      adjustmentNumber: adjustment.adjustmentNumber,
      entityId: adjustment.entityId.toString(),
      entityName,
      entityType: adjustment.entityType,
      type: adjustment.adjustmentType,
      description: adjustment.description,
      amount: adjustment.amount,
      amountIncludingGst: adjustment.amountIncludingGst,
      category: adjustment.category,
      status: adjustment.status,
      applyAfterDate: adjustment.applyAfterDate ? adjustment.applyAfterDate.toISOString() : null,
      autoApply: adjustment.autoApply,
      requiresApproval: adjustment.requiresApproval,
      relatedInvoiceNumber: adjustment.relatedInvoiceNumber,
      relatedPayRunNumber: adjustment.relatedPayRunNumber,
      relatedJobNumbers: adjustment.relatedJobNumbers || [],
      createdAt: adjustment.createdAt.toISOString(),
      createdBy: creatorName,
    };
  }

  static async deleteAdjustment(adjustmentId, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    });

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Cannot delete if status is not Draft
    if (adjustment.status !== "Draft") {
      throw new AppError(
        `Adjustment cannot be deleted. Current status: ${adjustment.status}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Cannot delete if already applied
    if (adjustment.status === "Applied") {
      throw new AppError("Cannot delete applied adjustments", HttpStatusCodes.BAD_REQUEST);
    }

    // Soft delete
    adjustment.deletedAt = new Date();
    await adjustment.save();
  }

  static async sendAdjustment(adjustmentId, data, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    });

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Adjustment must be in Draft or Approved status
    if (!["Draft", "Approved"].includes(adjustment.status)) {
      throw new AppError(
        `Adjustment cannot be sent. Current status: ${adjustment.status}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // If requiresApproval is true, adjustment must be Approved
    if (adjustment.requiresApproval && adjustment.status !== "Approved") {
      throw new AppError(
        "Adjustment requires approval before it can be sent",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate email if sendViaEmail is true
    if (data.sendViaEmail) {
      if (!data.emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.emailAddress)) {
        throw new AppError("Valid email address is required when sending via email", HttpStatusCodes.BAD_REQUEST);
      }
    }

    // Update status to Sent
    adjustment.status = "Sent";
    await adjustment.save();

    // TODO: Send email notification if sendViaEmail is true
    // This would integrate with the email service similar to how statements are sent
  }

  static async approveAdjustment(adjustmentId, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    });

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Adjustment must be in Pending Approval status
    if (adjustment.status !== "Pending Approval") {
      throw new AppError(
        `Adjustment cannot be approved. Current status: ${adjustment.status}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Adjustment must have requiresApproval set to true
    if (!adjustment.requiresApproval) {
      throw new AppError("Adjustment does not require approval", HttpStatusCodes.BAD_REQUEST);
    }

    // TODO: Check if user has manager approval permissions
    // For now, we'll allow any authenticated user to approve

    // Update adjustment
    adjustment.status = "Approved";
    adjustment.approvedBy = new mongoose.Types.ObjectId(user._id);
    adjustment.approvedAt = new Date();
    await adjustment.save();

    // Get approver name
    const approver = await User.findById(adjustment.approvedBy).lean();
    const approverName = getUserName(approver);

    return {
      id: adjustment._id.toString(),
      status: adjustment.status,
      approvedBy: approverName,
      approvedAt: adjustment.approvedAt.toISOString(),
    };
  }

  static async applyAdjustment(adjustmentId, data, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    });

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Adjustment must be Approved or Sent
    if (!["Approved", "Sent"].includes(adjustment.status)) {
      throw new AppError(
        `Adjustment cannot be applied. Current status: ${adjustment.status}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Check applyAfterDate if set
    if (adjustment.applyAfterDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const applyDate = new Date(adjustment.applyAfterDate);
      applyDate.setHours(0, 0, 0, 0);
      if (today < applyDate) {
        throw new AppError(
          `Adjustment cannot be applied before ${adjustment.applyAfterDate.toISOString().split("T")[0]}`,
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    // Validate applyToType and applyToId
    if (!data.applyToType || !["Invoice", "PayRun"].includes(data.applyToType)) {
      throw new AppError("Apply to type must be Invoice or PayRun", HttpStatusCodes.BAD_REQUEST);
    }

    if (!data.applyToId || !mongoose.Types.ObjectId.isValid(data.applyToId)) {
      throw new AppError("Valid apply to ID is required", HttpStatusCodes.BAD_REQUEST);
    }

    // Verify applyToId exists
    if (data.applyToType === "Invoice") {
      const invoice = await Invoice.findOne({
        _id: new mongoose.Types.ObjectId(data.applyToId),
        organizationId: orgId,
      }).lean();
      if (!invoice) {
        throw new AppError("Invoice not found", HttpStatusCodes.NOT_FOUND);
      }
    } else if (data.applyToType === "PayRun") {
      const payRun = await PayRun.findOne({
        _id: new mongoose.Types.ObjectId(data.applyToId),
        organizationId: orgId,
      }).lean();
      if (!payRun) {
        throw new AppError("Pay run not found", HttpStatusCodes.NOT_FOUND);
      }
    }

    // Validate apply amount
    const applyAmount = parseFloat(data.applyAmount);
    if (isNaN(applyAmount) || applyAmount <= 0) {
      throw new AppError("Apply amount must be greater than 0", HttpStatusCodes.BAD_REQUEST);
    }

    // Check if adjustment is already applied
    if (adjustment.status === "Applied") {
      throw new AppError("Adjustment has already been applied", HttpStatusCodes.BAD_REQUEST);
    }

    // Check if apply amount exceeds remaining adjustment amount
    // For now, we'll apply the full amount. In the future, we might support partial applications.
    if (applyAmount > adjustment.amountIncludingGst) {
      throw new AppError(
        "Apply amount cannot exceed adjustment amount",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Create application record
    const application = await AdjustmentApplication.create({
      adjustmentId: adjustment._id,
      appliedToType: data.applyToType,
      appliedToId: new mongoose.Types.ObjectId(data.applyToId),
      appliedAmount: applyAmount,
      appliedBy: new mongoose.Types.ObjectId(user._id),
    });

    // Update adjustment
    adjustment.status = "Applied";
    if (data.applyToType === "Invoice") {
      adjustment.appliedToInvoiceId = new mongoose.Types.ObjectId(data.applyToId);
    } else if (data.applyToType === "PayRun") {
      adjustment.appliedToPayRunId = new mongoose.Types.ObjectId(data.applyToId);
    }
    adjustment.appliedAt = new Date();
    await adjustment.save();

    // TODO: Update invoice/pay run totals with adjustment amount
    // This would require integration with InvoiceService or PayRunService

    return {
      id: adjustment._id.toString(),
      status: adjustment.status,
      appliedToInvoiceId: adjustment.appliedToInvoiceId ? adjustment.appliedToInvoiceId.toString() : null,
      appliedToPayRunId: adjustment.appliedToPayRunId ? adjustment.appliedToPayRunId.toString() : null,
      appliedAt: adjustment.appliedAt.toISOString(),
    };
  }

  static async resendAdjustment(adjustmentId, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    }).lean();

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only "Sent" adjustments can be resent
    if (adjustment.status !== "Sent") {
      throw new AppError(
        "Adjustment cannot be resent. Only 'Sent' adjustments can be resent.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Get entity email
    let recipientEmail = null;
    let entityName = null;

    if (adjustment.entityType === "Customer") {
      const customer = await Customer.findById(adjustment.entityId)
        .populate("partyId", "email")
        .lean();
      if (customer) {
        entityName = await getEntityName("Customer", adjustment.entityId);
        recipientEmail =
          customer.accountsEmail ||
          customer.primaryContactEmail ||
          customer.partyId?.email ||
          null;
      }
    } else if (adjustment.entityType === "Driver") {
      const driver = await Driver.findById(adjustment.entityId)
        .populate("partyId", "email")
        .lean();
      if (driver) {
        entityName = await getEntityName("Driver", adjustment.entityId);
        recipientEmail = driver.partyId?.email || null;
      }
    }

    if (!recipientEmail) {
      throw new AppError(
        "Recipient email not found. Cannot resend adjustment.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // TODO: Send email notification
    // This would integrate with the email service similar to how statements are sent
    // For now, we'll just return success

    // Update sentAt timestamp (optional - you might want to track resends separately)
    await Adjustment.updateOne(
      { _id: adjustment._id },
      { $set: { sentAt: new Date() } }
    );

    return {
      id: adjustment._id.toString(),
      status: adjustment.status,
      sentAt: new Date().toISOString(),
    };
  }

  static async generateAdjustmentPDF(adjustmentId, user) {
    const orgId = normalizeOrgId(null, user.activeOrganizationId);

    if (!mongoose.Types.ObjectId.isValid(adjustmentId)) {
      throw new AppError("Invalid adjustment ID", HttpStatusCodes.BAD_REQUEST);
    }

    const adjustment = await Adjustment.findOne({
      _id: new mongoose.Types.ObjectId(adjustmentId),
      organizationId: orgId,
      deletedAt: null,
    }).lean();

    if (!adjustment) {
      throw new AppError("Adjustment not found", HttpStatusCodes.NOT_FOUND);
    }

    // Get entity name
    const entityName = await getEntityName(adjustment.entityType, adjustment.entityId);

    // Generate PDF
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
          return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
        };

        // Helper function to format currency
        const formatCurrency = (amount) => {
          return `$${parseFloat(amount || 0).toFixed(2)}`;
        };

        // Header Section
        doc.fontSize(20).font("Helvetica-Bold").text("THE TRANSPORTER", { align: "center" });
        doc.fontSize(16).font("Helvetica").text("Adjustment Document", { align: "center" });
        doc.moveDown();

        // Adjustment details
        doc.fontSize(12);
        doc.text(`Adjustment Number: ${adjustment.adjustmentNumber}`);
        doc.text(`Date: ${formatDate(adjustment.createdAt)}`);
        doc.text(`Status: ${adjustment.status}`);
        doc.moveDown();

        // Entity and type
        doc.text(`Entity: ${entityName} (${adjustment.entityType})`);
        doc.text(`Type: ${adjustment.type}`);
        doc.text(`Category: ${adjustment.category}`);
        doc.moveDown();

        // Description
        doc.fontSize(10).text("Description:", { underline: true });
        doc.fontSize(10).text(adjustment.description);
        doc.moveDown();

        // Amounts
        doc.fontSize(12);
        doc.text(`Amount (excl. GST): ${formatCurrency(adjustment.amount)}`);
        doc.text(`GST (10%): ${formatCurrency(adjustment.gstAmount)}`);
        doc.text(`Total (incl. GST): ${formatCurrency(adjustment.amountIncludingGst)}`);
        doc.moveDown();

        // Notes for recipient
        if (adjustment.notesForRecipient) {
          doc.fontSize(10).text("Notes for Recipient:", { underline: true });
          doc.fontSize(10).text(adjustment.notesForRecipient);
          doc.moveDown();
        }

        // Related documents
        if (adjustment.relatedInvoiceNumber || adjustment.relatedPayRunNumber || (adjustment.relatedJobNumbers && adjustment.relatedJobNumbers.length > 0)) {
          doc.fontSize(10).text("Related Documents:", { underline: true });
          if (adjustment.relatedInvoiceNumber) {
            doc.text(`Invoice: ${adjustment.relatedInvoiceNumber}`);
          }
          if (adjustment.relatedPayRunNumber) {
            doc.text(`Pay Run: ${adjustment.relatedPayRunNumber}`);
          }
          if (adjustment.relatedJobNumbers && adjustment.relatedJobNumbers.length > 0) {
            doc.text(`Jobs: ${adjustment.relatedJobNumbers.join(", ")}`);
          }
          doc.moveDown();
        }

        // Footer
        doc.fontSize(8)
          .text(
            "THE TRANSPORTER - ANYTHING ANYWHERE ANYTIME",
            50,
            doc.page.height - 50,
            { align: "center", width: 500 }
          );

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = AdjustmentService;

