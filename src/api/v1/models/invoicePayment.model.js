const mongoose = require("mongoose");

const InvoicePaymentSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      enum: ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "BPAY", "OTHER"],
      required: true,
    },
    reference: {
      type: String,
      trim: true,
      default: null,
    },
    receiptDate: {
      type: Date,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null, // Optional - can be derived from invoice if needed
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes for efficient queries
InvoicePaymentSchema.index({ invoiceId: 1, createdAt: -1 });
InvoicePaymentSchema.index({ organizationId: 1, receiptDate: -1 });

// Virtual to populate invoice
InvoicePaymentSchema.virtual("invoice", {
  ref: "Invoice",
  localField: "invoiceId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("InvoicePayment", InvoicePaymentSchema);

