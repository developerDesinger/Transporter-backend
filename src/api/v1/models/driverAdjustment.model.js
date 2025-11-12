const mongoose = require("mongoose");

const DriverAdjustmentSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "POSTED"],
      default: "PENDING",
      index: true,
    },
    effectiveDate: {
      type: Date,
      required: true,
      index: true,
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
    postedAt: {
      type: Date,
      default: null,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
DriverAdjustmentSchema.index({ driverId: 1, status: 1 });
DriverAdjustmentSchema.index({ organizationId: 1, status: 1 });
DriverAdjustmentSchema.index({ effectiveDate: 1 });

module.exports = mongoose.model("DriverAdjustment", DriverAdjustmentSchema);

