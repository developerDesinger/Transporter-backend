const mongoose = require("mongoose");

const AllocatorRowSchema = new mongoose.Schema(
  {
    date: {
      type: String, // ISO date (YYYY-MM-DD)
      required: true,
      index: true,
    },
    boardType: {
      type: String,
      enum: ["PUD", "LINEHAUL"],
      required: true,
      default: "PUD",
      index: true,
    },
    status: {
      type: String,
      enum: ["Draft", "Locked", "Error"],
      default: "Draft",
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true,
    },
    vehicleType: {
      type: String,
      default: null,
    },
    serviceCode: {
      type: String,
      default: null,
    },
    pickupSuburb: {
      type: String,
      default: null,
    },
    deliverySuburb: {
      type: String,
      default: null,
    },
    startTime: {
      type: String, // HH:mm format
      default: null,
    },
    finishTime: {
      type: String, // HH:mm format
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    jobStatus: {
      type: String, // "Picked up", "Delivered", etc.
      default: null,
    },
    driverPay: {
      type: Number,
      default: null,
    },
    customerCharge: {
      type: Number,
      default: null,
    },
    fuelLevy: {
      type: Number,
      default: null,
    },
    pickupTime: {
      type: String, // HH:mm format
      default: null,
    },
    deliveryDate: {
      type: String, // ISO date (YYYY-MM-DD)
      default: null,
    },
    deliveryTime: {
      type: String, // HH:mm format
      default: null,
    },
    jobNumber: {
      type: String,
      default: null,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
      index: true,
    },
    ancillaryCharges: [
      {
        code: { type: String, required: true },
        name: { type: String, required: true },
        unitRate: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
        amount: { type: Number, required: true },
        notes: { type: String, default: null },
      },
    ],
    driverFullName: {
      type: String,
      default: null,
    },
    code: {
      type: String, // Driver code
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

// Compound indexes for common queries
AllocatorRowSchema.index({ date: 1, boardType: 1, status: 1 });
AllocatorRowSchema.index({ organizationId: 1, date: 1, boardType: 1 });

// Virtual to populate customer
AllocatorRowSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate driver
AllocatorRowSchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate job
AllocatorRowSchema.virtual("job", {
  ref: "Job",
  localField: "jobId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("AllocatorRow", AllocatorRowSchema);

