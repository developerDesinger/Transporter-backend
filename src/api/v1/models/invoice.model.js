const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNo: {
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
    issueDate: {
      type: Date,
      required: true,
      index: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"],
      default: "DRAFT",
      index: true,
    },
    totalExGst: {
      type: Number,
      required: true,
      default: 0,
    },
    gst: {
      type: Number,
      required: true,
      default: 0,
    },
    totalIncGst: {
      type: Number,
      required: true,
      default: 0,
    },
    balanceDue: {
      type: Number,
      required: true,
      default: 0,
    },
    grouping: {
      type: String,
      enum: ["DAY", "WEEK", "PO", "MONTH"],
      required: true,
    },
    purchaseOrderNumber: {
      type: String,
      default: null,
      trim: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound indexes
InvoiceSchema.index({ customerId: 1, issueDate: 1 });
InvoiceSchema.index({ status: 1 });
InvoiceSchema.index({ organizationId: 1, status: 1 });
InvoiceSchema.index({ customerId: 1, grouping: 1 });

// Virtual to populate customer
InvoiceSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate line items
InvoiceSchema.virtual("lineItems", {
  ref: "InvoiceLineItem",
  localField: "_id",
  foreignField: "invoiceId",
});

module.exports = mongoose.model("Invoice", InvoiceSchema);

