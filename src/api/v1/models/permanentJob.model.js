const mongoose = require("mongoose");

const PermanentJobSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    boardType: {
      type: String,
      required: true,
      enum: ["PUD", "LINEHAUL"],
      index: true,
    },
    serviceCode: {
      type: String,
      trim: true,
      default: null,
    },
    pickupSuburb: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    deliverySuburb: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    defaultVehicleType: {
      type: String,
      trim: true,
      default: null,
    },
    routeDescription: {
      type: String,
      trim: true,
      maxlength: 500,
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
PermanentJobSchema.index({ boardType: 1, isActive: 1 });
PermanentJobSchema.index({ organizationId: 1, boardType: 1, isActive: 1 });
PermanentJobSchema.index({ dayOfWeek: 1 });
PermanentJobSchema.index({ customerId: 1, boardType: 1 });

module.exports = mongoose.model("PermanentJob", PermanentJobSchema);

