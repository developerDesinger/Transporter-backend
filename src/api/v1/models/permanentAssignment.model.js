const mongoose = require("mongoose");

const PermanentAssignmentSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    boardType: {
      type: String,
      required: true,
      enum: ["PUD", "LINEHAUL"],
      index: true,
    },
    routeCode: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    routeDescription: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    defaultVehicleType: {
      type: String,
      trim: true,
      default: null,
    },
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      default: null,
    },
    defaultPickupTime: {
      type: String,
      trim: true,
      default: null,
      // HH:mm format validation
      validate: {
        validator: function (v) {
          if (!v) return true; // Allow null/empty
          return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: "defaultPickupTime must be in HH:mm format (24-hour)",
      },
    },
    defaultDropTime: {
      type: String,
      trim: true,
      default: null,
      // HH:mm format validation
      validate: {
        validator: function (v) {
          if (!v) return true; // Allow null/empty
          return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: "defaultDropTime must be in HH:mm format (24-hour)",
      },
    },
    startLocation: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    endLocation: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
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
PermanentAssignmentSchema.index({ boardType: 1, isActive: 1 });
PermanentAssignmentSchema.index({ organizationId: 1, boardType: 1, isActive: 1 });
PermanentAssignmentSchema.index({ dayOfWeek: 1 });
PermanentAssignmentSchema.index({ driverId: 1, boardType: 1 });

module.exports = mongoose.model("PermanentAssignment", PermanentAssignmentSchema);

