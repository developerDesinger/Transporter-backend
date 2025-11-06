const mongoose = require("mongoose");

const RCTILogSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    driverName: {
      type: String,
      required: true,
    }, // Persisted at time of sending for audit trail
    rctiNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    }, // Unique RCTI invoice number (e.g., "RCTI-2024-001")
    payrunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayRun",
      required: true,
      index: true,
    },
    payRunNumber: {
      type: String,
      required: true,
    }, // Persisted at time of sending for audit trail
    sentTo: {
      type: String,
      required: true,
    }, // Email address
    sentAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },
    autoSent: {
      type: Boolean,
      default: false,
    }, // Whether RCTI was sent automatically or manually
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    totalAmount: {
      type: String,
      required: true,
    }, // Total amount (including GST)
    errorMessage: {
      type: String,
      default: null,
    }, // Error message if status is "failed"
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes for efficient queries
RCTILogSchema.index({ driverId: 1, sentAt: -1 });
RCTILogSchema.index({ payrunId: 1, sentAt: -1 });
RCTILogSchema.index({ status: 1, sentAt: -1 });
RCTILogSchema.index({ rctiNumber: 1 }); // Already unique, but explicit index

// Virtual to populate driver
RCTILogSchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("RCTILog", RCTILogSchema);

