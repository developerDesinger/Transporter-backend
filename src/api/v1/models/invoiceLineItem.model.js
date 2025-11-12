const mongoose = require("mongoose");

const InvoiceLineItemSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
      index: true,
    },
    allocatorRowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AllocatorRow",
      default: null,
      index: true,
    },
    date: {
      type: String, // ISO date (YYYY-MM-DD)
      required: true,
    },
    jobNumber: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
InvoiceLineItemSchema.index({ invoiceId: 1 });
InvoiceLineItemSchema.index({ jobId: 1 });
InvoiceLineItemSchema.index({ allocatorRowId: 1 });

module.exports = mongoose.model("InvoiceLineItem", InvoiceLineItemSchema);

