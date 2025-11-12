const mongoose = require("mongoose");

const PayRunSchema = new mongoose.Schema(
  {
    payRunNumber: {
      type: String,
      required: false, // Will be auto-generated if not provided
      unique: true,
      sparse: true,
      index: true,
    },
    label: {
      type: String,
      trim: true,
      default: null,
    },
    cohortDays: {
      type: Number,
      required: true,
      enum: [7, 14, 21, 30],
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
      index: true,
    },
    periodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "POSTED", "VOID", "PROCESSING", "COMPLETED", "CANCELLED"],
      default: "DRAFT",
      index: true,
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    postedAt: {
      type: Date,
      default: null,
    },
    // Link to organization (multi-tenant)
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes for efficient queries
PayRunSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
PayRunSchema.index({ organizationId: 1, cohortDays: 1 });
PayRunSchema.index({ periodStart: 1, periodEnd: 1 });

module.exports = mongoose.model("PayRun", PayRunSchema);

