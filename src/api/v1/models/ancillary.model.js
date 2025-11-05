const mongoose = require("mongoose");

const AncillarySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String },
    rateType: {
      type: String,
      enum: ["HOURLY", "FIXED", "PERCENTAGE"],
      required: true,
    },
    rate: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
      enum: ["PER_HOUR", "PER_KM", "PER_PALLET", "FIXED"],
      default: "PER_HOUR",
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model("Ancillary", AncillarySchema);

