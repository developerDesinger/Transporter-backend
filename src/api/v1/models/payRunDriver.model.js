const mongoose = require("mongoose");

const PayRunDriverSchema = new mongoose.Schema(
  {
    payrunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayRun",
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0,
    }, // Total amount for this driver in this pay run
    hours: {
      type: Number,
      default: 0,
    },
    // Additional pay run driver details can be added here
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for efficient lookups
PayRunDriverSchema.index({ payrunId: 1, driverId: 1 }, { unique: true });
PayRunDriverSchema.index({ driverId: 1, createdAt: -1 });

// Virtual to populate driver
PayRunDriverSchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate pay run
PayRunDriverSchema.virtual("payRun", {
  ref: "PayRun",
  localField: "payrunId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("PayRunDriver", PayRunDriverSchema);

