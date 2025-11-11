const mongoose = require("mongoose");

const VehicleTypeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
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

// Compound indexes
VehicleTypeSchema.index({ sortOrder: 1, code: 1 });
VehicleTypeSchema.index({ organizationId: 1, isActive: 1 });

module.exports = mongoose.model("VehicleType", VehicleTypeSchema);

