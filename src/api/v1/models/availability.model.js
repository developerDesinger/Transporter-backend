const mongoose = require("mongoose");

const AvailabilitySchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    date: {
      type: String, // ISO date (YYYY-MM-DD)
      required: true,
      index: true,
    },
    vehicleType: {
      type: String,
      default: null,
    },
    bodyType: {
      type: String,
      default: null,
    },
    currentLocation: {
      type: String,
      default: null,
    },
    destinationWanted: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    isAvailable: {
      type: Boolean,
      default: true,
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
AvailabilitySchema.index({ driverId: 1, date: 1 }, { unique: true });
AvailabilitySchema.index({ date: 1, isAvailable: 1 });

// Virtual to populate driver
AvailabilitySchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Availability", AvailabilitySchema);

