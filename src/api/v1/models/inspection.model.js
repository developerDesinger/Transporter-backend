const mongoose = require("mongoose");

const InspectionSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DocumentTemplate",
      default: null,
    },
    inspectedAt: {
      type: Date,
      required: true,
      index: true,
    },
    inspectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    inspectorName: {
      type: String,
      required: true,
      trim: true,
    },
    result: {
      type: String,
      enum: ["pass", "fail"],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["Prestart", "Quarterly", "Annual"],
      required: true,
      index: true,
    },
    odometerKm: {
      type: Number,
      min: 0,
      default: null,
    },
    engineHours: {
      type: Number,
      min: 0,
      default: null,
    },
    photos: {
      type: [String],
      default: [],
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
InspectionSchema.index({ vehicleId: 1, inspectedAt: -1 });
InspectionSchema.index({ organizationId: 1, vehicleId: 1 });

module.exports = mongoose.model("Inspection", InspectionSchema);

