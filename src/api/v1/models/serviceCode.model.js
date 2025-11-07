const mongoose = require("mongoose");

const ServiceCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    vehicleClass: {
      type: String,
      default: null, // Vehicle classification (e.g., "4 Tonne", "Light Rigid")
      trim: true,
    },
    body: {
      type: String,
      default: null, // Body type (e.g., "Tautliner", "Pantech", "Flatbed")
      trim: true,
    },
    pallets: {
      type: String,
      default: null, // Number of pallets (e.g., "8.0") - stored as string for precision
      trim: true,
    },
    features: {
      type: String,
      default: null, // Special features (e.g., "Tail Lift, Hiab") - free text
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: null, // Display order for sorting
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

// Compound index for unique code per organization
ServiceCodeSchema.index({ code: 1, organizationId: 1 }, { unique: true });
// Index for sorting
ServiceCodeSchema.index({ organizationId: 1, sortOrder: 1, code: 1 });

module.exports = mongoose.model("ServiceCode", ServiceCodeSchema);

