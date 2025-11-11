const mongoose = require("mongoose");

const WorkOrderSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    openedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    closedAt: {
      type: Date,
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["Service", "Repair"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in-progress", "completed", "closed", "cancelled"],
      default: "open",
      index: true,
    },
    tasks: {
      type: [String],
      required: true,
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: "Tasks array must contain at least one task",
      },
    },
    parts: {
      type: [
        {
          name: { type: String, required: true },
          partNumber: { type: String, default: null },
          quantity: { type: Number, required: true, min: 1 },
          unitCost: { type: Number, required: true, min: 0 }, // in cents
          totalCost: { type: Number, required: true, min: 0 }, // in cents
        },
      ],
      default: [],
    },
    labourHours: {
      type: Number,
      min: 0,
      default: null,
    },
    totalCost: {
      type: Number,
      default: 0,
      min: 0, // in cents
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      default: null,
      index: true,
    },
    documents: {
      type: [String],
      default: [],
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    description: {
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
WorkOrderSchema.index({ vehicleId: 1, openedAt: -1 });
WorkOrderSchema.index({ organizationId: 1, vehicleId: 1 });
WorkOrderSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model("WorkOrder", WorkOrderSchema);

