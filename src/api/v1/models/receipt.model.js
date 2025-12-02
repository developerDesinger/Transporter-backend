const mongoose = require("mongoose");

const ReceiptSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    receiptDate: {
      type: Date,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "BPAY", "OTHER"],
      required: true,
    },
    reference: {
      type: String,
      trim: true,
      default: null,
    },
    bankAccount: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
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

// Indexes
ReceiptSchema.index({ organizationId: 1, receiptDate: -1 });
ReceiptSchema.index({ customerId: 1 });
ReceiptSchema.index({ receiptNumber: 1 });

// Virtual to populate customer
ReceiptSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Receipt", ReceiptSchema);

