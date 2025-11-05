const mongoose = require("mongoose");

const ServiceCodeSchema = new mongoose.Schema(
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
    vehicleClass: {
      type: String,
      enum: ["LIGHT", "MEDIUM", "HEAVY"],
      default: null,
    },
    body: {
      type: String,
      enum: ["PANTECH", "TAUTLINER", "FLATTOP", "REFER", "OTHER"],
      default: null,
    },
    pallets: { type: Number },
    features: [{ type: String }], // Array of feature codes like "TAIL_LIFT", "HIAB", "FREEZER"
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model("ServiceCode", ServiceCodeSchema);

