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
    fileSize: { type: Number }, // Bytes
    mimeType: { type: String }, // "application/pdf", "image/jpeg", etc.
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index
DriverDocumentSchema.index({ driverId: 1, documentType: 1 }, { unique: true });

module.exports = mongoose.model("DriverDocument", DriverDocumentSchema);

