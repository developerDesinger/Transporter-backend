const mongoose = require("mongoose");

const PayRunItemSchema = new mongoose.Schema(
  {
    payrunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayRun",
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["JOB", "ADJUSTMENT"],
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
      index: true,
    },
    driverAdjustmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DriverAdjustment",
      default: null,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    excluded: {
      type: Boolean,
      default: false,
      index: true,
    },
    excludeReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
PayRunItemSchema.index({ payrunId: 1, driverId: 1 });
PayRunItemSchema.index({ jobId: 1 });
PayRunItemSchema.index({ driverAdjustmentId: 1 });

module.exports = mongoose.model("PayRunItem", PayRunItemSchema);

