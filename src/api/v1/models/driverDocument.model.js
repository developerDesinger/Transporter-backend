const mongoose = require("mongoose");

const DriverDocumentSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: [
        "MOTOR_INSURANCE",
        "MARINE_CARGO_INSURANCE",
        "PUBLIC_LIABILITY",
        "WORKERS_COMP",
        "LICENSE_FRONT",
        "LICENSE_BACK",
        "POLICE_CHECK",
      ],
      required: true,
      index: true,
    },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true }, // Bytes
    mimeType: { type: String, required: true }, // "application/pdf", "image/jpeg", etc.
    uploadedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index
DriverDocumentSchema.index({ driverId: 1, documentType: 1 }, { unique: true });
DriverDocumentSchema.index({ driverId: 1, uploadedAt: -1 });
DriverDocumentSchema.index({ status: 1, uploadedAt: -1 });

// Virtual to populate reviewedBy user
DriverDocumentSchema.virtual("reviewedByUser", {
  ref: "User",
  localField: "reviewedBy",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("DriverDocument", DriverDocumentSchema);

