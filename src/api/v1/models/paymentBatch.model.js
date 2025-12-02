const mongoose = require("mongoose");

const PaymentBatchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    filePath: {
      type: String,
      required: true,
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    totalLines: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    processedLines: {
      type: Number,
      default: 0,
      min: 0,
    },
    matchedLines: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["Pending", "Processing", "Completed", "Failed"],
      default: "Pending",
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
PaymentBatchSchema.index({ organizationId: 1, status: 1 });
PaymentBatchSchema.index({ organizationId: 1, createdAt: -1 });

// Virtual to populate uploadedBy
PaymentBatchSchema.virtual("owner", {
  ref: "User",
  localField: "uploadedBy",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("PaymentBatch", PaymentBatchSchema);

