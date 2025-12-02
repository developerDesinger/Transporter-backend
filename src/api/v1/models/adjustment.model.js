const mongoose = require("mongoose");

const AdjustmentSchema = new mongoose.Schema(
  {
    adjustmentNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    entityType: {
      type: String,
      enum: ["Customer", "Driver"],
      required: true,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      // Reference will be populated based on entityType
    },
    adjustmentType: {
      type: String,
      enum: ["Credit", "Charge"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    amountIncludingGst: {
      type: Number,
      required: true,
      min: 0,
    },
    gstAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      enum: ["Goodwill", "Missed Charge", "Service Issue", "Pricing Error", "Other"],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    notesForRecipient: {
      type: String,
      required: true,
      trim: true,
    },
    internalNotes: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Draft", "Sent", "Pending Approval", "Approved", "Applied"],
      default: "Draft",
      index: true,
    },
    applyAfterDate: {
      type: Date,
      default: null,
    },
    autoApply: {
      type: Boolean,
      default: false,
    },
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    appliedToInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    appliedToPayRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayRun",
      default: null,
    },
    appliedAt: {
      type: Date,
      default: null,
    },
    relatedInvoiceNumber: {
      type: String,
      default: null,
      trim: true,
    },
    relatedPayRunNumber: {
      type: String,
      default: null,
      trim: true,
    },
    relatedJobNumbers: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
AdjustmentSchema.index({ entityType: 1, entityId: 1 });
AdjustmentSchema.index({ organizationId: 1, status: 1 });
AdjustmentSchema.index({ organizationId: 1, adjustmentType: 1 });
AdjustmentSchema.index({ organizationId: 1, createdAt: -1 });
AdjustmentSchema.index({ deletedAt: 1 });

// Note: Entity will be populated manually based on entityType

module.exports = mongoose.model("Adjustment", AdjustmentSchema);

