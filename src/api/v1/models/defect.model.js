const mongoose = require("mongoose");

const DefectSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reportedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    severity: {
      type: String,
      enum: ["minor", "moderate", "critical"],
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    photos: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["open", "in-progress", "resolved", "closed"],
      default: "open",
      index: true,
    },
    workOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkOrder",
      default: null,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
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
DefectSchema.index({ vehicleId: 1, reportedAt: -1 });
DefectSchema.index({ organizationId: 1, vehicleId: 1 });
DefectSchema.index({ status: 1, severity: 1 });

module.exports = mongoose.model("Defect", DefectSchema);

