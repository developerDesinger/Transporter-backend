const mongoose = require("mongoose");

const PayRunSchema = new mongoose.Schema(
  {
    payRunNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "PROCESSING", "COMPLETED", "CANCELLED"],
      default: "DRAFT",
      index: true,
    },
    totalAmount: {
      type: Number,
      default: 0,
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

// Index for efficient queries
PayRunSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PayRun", PayRunSchema);

