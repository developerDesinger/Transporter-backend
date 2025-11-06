const mongoose = require("mongoose");

const DriverRateSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    serviceCode: {
      type: String,
      default: null, // Required for hourly rates
      index: true,
    },
    vehicleType: {
      type: String,
      required: true,
      index: true,
    },
    payPerHour: {
      type: Number,
      default: null, // For hourly rates
    },
    rateType: {
      type: String,
      enum: ["HOURLY", "FTL"],
      required: true,
      index: true,
    },
    laneKey: {
      type: String,
      default: null, // For FTL rates
      index: true,
    },
    flatRate: {
      type: Number,
      default: null, // For FTL rates
    },
    isLocked: { type: Boolean, default: false },
    lockedAt: { type: Date, default: null }, // Timestamp when rates were locked
    effectiveFrom: { type: Date, default: Date.now }, // When rate becomes active
    effectiveTo: { type: Date, default: null }, // When rate expires (null = current rate)
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for rate lookups
DriverRateSchema.index({ driverId: 1, rateType: 1, serviceCode: 1, vehicleType: 1 });
DriverRateSchema.index({ driverId: 1, rateType: 1, vehicleType: 1, laneKey: 1 });
// Index for current rates lookup (effectiveTo = null)
DriverRateSchema.index({ driverId: 1, effectiveTo: 1 });
DriverRateSchema.index({ driverId: 1, isLocked: 1, effectiveTo: 1 });

module.exports = mongoose.model("DriverRate", DriverRateSchema);

