const mongoose = require("mongoose");

const RateCardSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null, // null = house rate card
      index: true,
    },
    rateType: {
      type: String,
      enum: ["HOURLY", "FTL"],
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
    laneKey: {
      type: String,
      default: null, // Required for FTL rates (e.g., "SYD-MEL")
      index: true,
    },
    rateExGst: {
      type: Number,
      required: true,
    },
    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now,
    },
    description: { type: String },
    isLocked: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for rate lookups
RateCardSchema.index({ customerId: 1, rateType: 1, serviceCode: 1, vehicleType: 1 });
RateCardSchema.index({ customerId: 1, rateType: 1, vehicleType: 1, laneKey: 1 });

module.exports = mongoose.model("RateCard", RateCardSchema);

