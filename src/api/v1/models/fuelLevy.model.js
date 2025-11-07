const mongoose = require("mongoose");

const FuelLevySchema = new mongoose.Schema(
  {
    version: {
      type: Number,
      required: true,
      index: true,
    },
    metroPct: {
      type: String,
      required: true, // Metro/Local fuel levy percentage (e.g., "5.25")
    },
    interstatePct: {
      type: String,
      required: true, // Interstate/FTL fuel levy percentage (e.g., "10.15")
    },
    effectiveFrom: {
      type: Date,
      required: true,
      index: true,
    },
    effectiveTo: {
      type: Date,
      default: null, // null = current active fuel levy
      index: true,
    },
    notes: {
      type: String,
      default: null,
    },
    pegDateFuelPrice: {
      type: String,
      default: null, // Fuel price at peg date (A in formula)
    },
    newRefFuelPrice: {
      type: String,
      default: null, // Fuel price at new reference period (B in formula)
    },
    lineHaulWeighting: {
      type: String,
      default: null, // Line haul weighting factor (C for interstate)
    },
    localWeighting: {
      type: String,
      default: null, // Local weighting factor (C for metro)
    },
    // Multi-tenant support
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound indexes
FuelLevySchema.index({ organizationId: 1, version: 1 }); // Unique version per organization
FuelLevySchema.index({ organizationId: 1, effectiveTo: 1 }); // For current fuel levy lookup

module.exports = mongoose.model("FuelLevy", FuelLevySchema);

