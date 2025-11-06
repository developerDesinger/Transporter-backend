const mongoose = require("mongoose");

const DriverLinkedDocumentSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
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
DriverLinkedDocumentSchema.virtual("template", {
  ref: "DocumentTemplate",
  localField: "templateId",
  foreignField: "_id",
  justOne: true,
});

// Compound index for efficient queries
DriverLinkedDocumentSchema.index({ driverId: 1, templateId: 1 }, { unique: true });
DriverLinkedDocumentSchema.index({ driverId: 1, createdAt: -1 });

module.exports = mongoose.model("DriverLinkedDocument", DriverLinkedDocumentSchema);

