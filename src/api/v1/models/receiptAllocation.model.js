const mongoose = require("mongoose");

const ReceiptAllocationSchema = new mongoose.Schema(
  {
    receiptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Receipt",
      required: true,
      index: true,
    },
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
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
ReceiptAllocationSchema.index({ receiptId: 1 });
ReceiptAllocationSchema.index({ invoiceId: 1 });
ReceiptAllocationSchema.index({ receiptId: 1, invoiceId: 1 });

// Virtual to populate receipt
ReceiptAllocationSchema.virtual("receipt", {
  ref: "Receipt",
  localField: "receiptId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate invoice
ReceiptAllocationSchema.virtual("invoice", {
  ref: "Invoice",
  localField: "invoiceId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("ReceiptAllocation", ReceiptAllocationSchema);

