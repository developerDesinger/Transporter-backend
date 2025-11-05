const mongoose = require("mongoose");

const FuelLevySchema = new mongoose.Schema(
  {
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

module.exports = mongoose.model("FuelLevy", FuelLevySchema);

