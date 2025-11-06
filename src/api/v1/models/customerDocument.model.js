const mongoose = require("mongoose");

const CustomerDocumentSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ["APPLICATION_PDF", "CONTRACT", "INSURANCE", "OTHER"],
      required: true,
    },
    title: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true }, // Size in bytes
    mimeType: { type: String, required: true },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual to populate uploadedBy user
CustomerDocumentSchema.virtual("uploadedByUser", {
  ref: "User",
  localField: "uploadedBy",
  foreignField: "_id",
  justOne: true,
});

// Index for efficient queries
CustomerDocumentSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model("CustomerDocument", CustomerDocumentSchema);

