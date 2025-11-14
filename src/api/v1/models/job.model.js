const mongoose = require("mongoose");

const JobSchema = new mongoose.Schema(
  {
    jobNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    vehicleType: {
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
    date: {
      type: String, // ISO date (YYYY-MM-DD) - job date
      required: true,
      index: true,
    },
    boardType: {
      type: String,
      enum: ["PUD", "LINEHAUL"],
      required: true,
      index: true,
    },
    allocatorRowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AllocatorRow",
      default: null,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
    // Driver pay fields
    driverPayStatus: {
      type: String,
      enum: ["UNPOSTED", "POSTED", "VOID"],
      default: "UNPOSTED",
      index: true,
    },
    driverPayDeferralUntil: {
      type: Date,
      default: null,
      index: true,
    },
    driverPayrunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayRun",
      default: null,
      index: true,
    },
    driverPayPostedAt: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
    closedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound indexes
JobSchema.index({ date: 1, boardType: 1, status: 1 });
JobSchema.index({ organizationId: 1, date: 1 });

// Virtual to populate customer
JobSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate driver
JobSchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Job", JobSchema);

