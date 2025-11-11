const mongoose = require("mongoose");

const DriverUsageSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    boardType: {
      type: String,
      enum: ["PUD", "LINEHAUL"],
      required: true,
      index: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
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

// Compound index
DriverUsageSchema.index({ driverId: 1, boardType: 1, assignedAt: -1 });

// Virtual to populate driver
DriverUsageSchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("DriverUsage", DriverUsageSchema);

