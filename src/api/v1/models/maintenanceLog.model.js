const mongoose = require("mongoose");

const MaintenanceLogSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    schedule: {
      type: String,
      required: true,
      maxlength: 100,
      trim: true,
    },
    maintenanceDate: {
      type: Date,
      required: true,
      index: true,
    },
    conductorName: {
      type: String,
      required: true,
      maxlength: 200,
      trim: true,
    },
    conductorQualifications: {
      type: String,
      maxlength: 200,
      trim: true,
      default: null,
    },
    workDescription: {
      type: String,
      required: true,
      maxlength: 2000,
      trim: true,
    },
    nextMaintenanceDue: {
      type: Date,
      index: true,
      default: null,
    },
    approverName: {
      type: String,
      maxlength: 200,
      trim: true,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound indexes
MaintenanceLogSchema.index({ vehicleId: 1, maintenanceDate: -1 });
MaintenanceLogSchema.index({ vehicleId: 1, nextMaintenanceDue: 1 });
MaintenanceLogSchema.index({ organizationId: 1 });

module.exports = mongoose.model("MaintenanceLog", MaintenanceLogSchema);

