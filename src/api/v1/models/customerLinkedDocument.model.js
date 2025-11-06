const mongoose = require("mongoose");

const CustomerLinkedDocumentSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DocumentTemplate",
      required: true,
      index: true,
    },
    customizedContent: { type: String, default: null },
    status: {
      type: String,
      enum: ["DRAFT", "SENT", "SIGNED"],
      default: "DRAFT",
    },
    sentAt: { type: Date, default: null },
    sentTo: { type: String, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual to populate template
CustomerLinkedDocumentSchema.virtual("template", {
  ref: "DocumentTemplate",
  localField: "templateId",
  foreignField: "_id",
  justOne: true,
});

// Compound index for efficient queries
CustomerLinkedDocumentSchema.index({ customerId: 1, templateId: 1 }, { unique: true });
CustomerLinkedDocumentSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model("CustomerLinkedDocument", CustomerLinkedDocumentSchema);

