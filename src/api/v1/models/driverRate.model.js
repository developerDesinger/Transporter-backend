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
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for rate lookups
DriverRateSchema.index({ driverId: 1, rateType: 1, serviceCode: 1, vehicleType: 1 });
DriverRateSchema.index({ driverId: 1, rateType: 1, vehicleType: 1, laneKey: 1 });

module.exports = mongoose.model("DriverRate", DriverRateSchema);

