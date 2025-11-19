const mongoose = require("mongoose");

const InvoiceGroupSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
      index: true,
    },
    periodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    grouping: {
      type: String,
      enum: ["DAY", "WEEK", "PO"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "READY"],
      default: "DRAFT",
      index: true,
    },
    purchaseOrderNumber: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes
InvoiceGroupSchema.index({ organizationId: 1, customerId: 1 });
InvoiceGroupSchema.index({ organizationId: 1, status: 1 });
InvoiceGroupSchema.index({ organizationId: 1, grouping: 1 });
InvoiceGroupSchema.index({ organizationId: 1, periodStart: 1, periodEnd: 1 });

// Virtual to populate customer
InvoiceGroupSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate jobs
InvoiceGroupSchema.virtual("jobs", {
  ref: "InvoiceGroupJob",
  localField: "_id",
  foreignField: "invoiceGroupId",
});

module.exports = mongoose.model("InvoiceGroup", InvoiceGroupSchema);

