const mongoose = require("mongoose");

const InvoiceGroupJobSchema = new mongoose.Schema(
  {
    invoiceGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceGroup",
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Unique constraint: one job can only be in one group
InvoiceGroupJobSchema.index({ invoiceGroupId: 1, jobId: 1 }, { unique: true });

// Indexes for efficient queries
InvoiceGroupJobSchema.index({ invoiceGroupId: 1 });
InvoiceGroupJobSchema.index({ jobId: 1 });

// Virtual to populate job
InvoiceGroupJobSchema.virtual("job", {
  ref: "Job",
  localField: "jobId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate invoice group
InvoiceGroupJobSchema.virtual("invoiceGroup", {
  ref: "InvoiceGroup",
  localField: "invoiceGroupId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("InvoiceGroupJob", InvoiceGroupJobSchema);

