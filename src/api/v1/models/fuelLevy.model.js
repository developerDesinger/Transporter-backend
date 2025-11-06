const mongoose = require("mongoose");

const FuelLevySchema = new mongoose.Schema(
  {
    rateType: {
      type: String,
      enum: ["HOURLY", "FTL"],
      required: true,
      index: true,
    },
    percentage: {
      type: Number,
      required: false,
    },
    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    effectiveTo: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for rateType and isActive lookups
FuelLevySchema.index({ rateType: 1, isActive: 1, effectiveFrom: -1 });

module.exports = mongoose.model("FuelLevy", FuelLevySchema);

