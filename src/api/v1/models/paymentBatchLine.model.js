const mongoose = require("mongoose");

const PaymentBatchLineSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentBatch",
      required: true,
      index: true,
    },
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    reference: {
      type: String,
      trim: true,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    matchedInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Matched", "Unmatched", "Error"],
      default: "Pending",
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
PaymentBatchLineSchema.index({ batchId: 1, lineNumber: 1 });
PaymentBatchLineSchema.index({ batchId: 1, status: 1 });

// Virtual to populate batch
PaymentBatchLineSchema.virtual("batch", {
  ref: "PaymentBatch",
  localField: "batchId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate matched invoice
PaymentBatchLineSchema.virtual("matchedInvoice", {
  ref: "Invoice",
  localField: "matchedInvoiceId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("PaymentBatchLine", PaymentBatchLineSchema);

