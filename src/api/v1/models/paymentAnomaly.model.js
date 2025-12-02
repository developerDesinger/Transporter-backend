const mongoose = require("mongoose");

const PaymentAnomalySchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Receipt",
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["SHORT_PAYMENT", "UNALLOCATED", "OVERPAYMENT"],
      required: true,
      index: true,
    },
    expectedAmount: {
      type: Number,
      default: null,
    },
    actualAmount: {
      type: Number,
      default: null,
    },
    variance: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ["Open", "Investigating", "Resolved"],
      default: "Open",
      index: true,
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
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
PaymentAnomalySchema.index({ organizationId: 1, status: 1 });
PaymentAnomalySchema.index({ organizationId: 1, type: 1 });
PaymentAnomalySchema.index({ paymentId: 1 });
PaymentAnomalySchema.index({ invoiceId: 1 });

// Virtual to populate payment
PaymentAnomalySchema.virtual("payment", {
  ref: "Receipt",
  localField: "paymentId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate invoice
PaymentAnomalySchema.virtual("invoice", {
  ref: "Invoice",
  localField: "invoiceId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("PaymentAnomaly", PaymentAnomalySchema);

