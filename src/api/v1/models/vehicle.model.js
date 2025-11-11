const mongoose = require("mongoose");

const VehicleSchema = new mongoose.Schema(
  {
    fleetNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 50,
      index: true,
      uppercase: true,
    },
    registration: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 20,
      index: true,
      uppercase: true,
    },
    vin: {
      type: String,
      trim: true,
      maxlength: 17,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    regoExpiry: {
      type: Date,
      default: null,
      index: true,
    },
    make: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    model: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    year: {
      type: Number,
      min: 1900,
      max: new Date().getFullYear() + 1,
      default: null,
    },
    gvm: {
      type: Number,
      min: 0,
      default: null,
    },
    gcm: {
      type: Number,
      min: 0,
      default: null,
    },
    axleConfig: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
    },
    ownership: {
      type: String,
      enum: ["Owned", "Leased", "Subbie"],
      default: "Owned",
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "workshop", "hold"],
      default: "active",
      index: true,
    },
    insurancePolicyNo: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    insuranceExpiry: {
      type: Date,
      default: null,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound indexes
VehicleSchema.index({ fleetNo: 1, organizationId: 1 });
VehicleSchema.index({ registration: 1, organizationId: 1 });
VehicleSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model("Vehicle", VehicleSchema);

