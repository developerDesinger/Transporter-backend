const mongoose = require("mongoose");

const InvoiceDraftLineSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null, // NULL until attached to an invoice
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    qty: {
      type: Number,
      required: true,
      default: 1,
    },
    rate: {
      type: String, // baseCharge as string
      required: true,
    },
    fuelPercent: {
      type: String, // fuelLevyPercent as string
      default: "0.00",
    },
    surcharges: {
      type: Array, // JSON array
      default: [],
    },
    amountExGst: {
      type: String, // baseCharge as string (fuel added at invoice time)
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
InvoiceDraftLineSchema.index({ customerId: 1, invoiceId: 1 });
InvoiceDraftLineSchema.index({ jobId: 1 });
InvoiceDraftLineSchema.index({ organizationId: 1, invoiceId: 1 }); // For unattached draft lines

module.exports = mongoose.model("InvoiceDraftLine", InvoiceDraftLineSchema);

