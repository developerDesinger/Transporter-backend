const mongoose = require("mongoose");

const AvailableJobSchema = new mongoose.Schema(
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
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    customerName: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    origin: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    destination: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    vehicleTypeRequired: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    bodyTypeRequired: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    status: {
      type: String,
      enum: ["AVAILABLE", "ASSIGNED", "CANCELLED"],
      default: "AVAILABLE",
      index: true,
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
AvailableJobSchema.index({ date: 1, boardType: 1, organizationId: 1 });
AvailableJobSchema.index({ date: 1, boardType: 1, customerId: 1, organizationId: 1 }); // For duplicate detection
AvailableJobSchema.index({ status: 1 });

// Virtual to populate customer
AvailableJobSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("AvailableJob", AvailableJobSchema);

