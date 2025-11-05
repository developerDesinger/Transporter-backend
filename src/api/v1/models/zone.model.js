const mongoose = require("mongoose");

const ZoneSchema = new mongoose.Schema(
  {
    zoneName: { type: String, required: true, index: true },
    suburb: { type: String, required: true, index: true },
    state: { type: String, required: true, index: true },
    postcode: { type: String, required: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for zone lookups
ZoneSchema.index({ suburb: 1, state: 1, postcode: 1 });

module.exports = mongoose.model("Zone", ZoneSchema);

