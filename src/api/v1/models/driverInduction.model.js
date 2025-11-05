const mongoose = require("mongoose");

const DriverInductionSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Driver is a user with DRIVER role
      required: true,
      index: true,
    },
    inductionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Induction",
      required: true,
      index: true,
    },
    completionDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    evidenceUrl: { type: String },
    status: {
      type: String,
      enum: ["current", "expired", "pending"],
      default: "current",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index
DriverInductionSchema.index({ driverId: 1, inductionId: 1 }, { unique: true });

module.exports = mongoose.model("DriverInduction", DriverInductionSchema);

