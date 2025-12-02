const mongoose = require("mongoose");

const AdjustmentApplicationSchema = new mongoose.Schema(
  {
    adjustmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Adjustment",
      required: true,
      index: true,
    },
    appliedToType: {
      type: String,
      enum: ["Invoice", "PayRun"],
      required: true,
      index: true,
    },
    appliedToId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      // Reference will be populated based on appliedToType
    },
    appliedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
AdjustmentApplicationSchema.index({ adjustmentId: 1 });
AdjustmentApplicationSchema.index({ appliedToType: 1, appliedToId: 1 });
AdjustmentApplicationSchema.index({ appliedBy: 1 });

// Note: Applied to entity will be populated manually based on appliedToType

// Virtual for applied by user
AdjustmentApplicationSchema.virtual("appliedByUser", {
  ref: "User",
  localField: "appliedBy",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("AdjustmentApplication", AdjustmentApplicationSchema);

