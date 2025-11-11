const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    basis: {
      type: String,
      enum: ["KM", "HOURS", "TIME"],
      required: true,
      index: true,
    },
    intervalValue: {
      type: Number,
      required: true,
      min: 0.01,
    },
    nextDueAt: {
      type: Date,
      default: null,
      index: true,
    },
    nextDueKm: {
      type: Number,
      min: 0,
      default: null,
    },
    nextDueHours: {
      type: Number,
      min: 0,
      default: null,
    },
    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
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
ScheduleSchema.index({ vehicleId: 1, status: 1 });
ScheduleSchema.index({ organizationId: 1, vehicleId: 1 });
ScheduleSchema.index({ nextDueAt: 1, status: 1 });

module.exports = mongoose.model("Schedule", ScheduleSchema);

