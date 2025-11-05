const mongoose = require("mongoose");

const DocumentTemplateSchema = new mongoose.Schema(
  {
    documentKey: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
      validate: {
        validator: function (v) {
          return /^[A-Z_]+$/.test(v); // Only uppercase letters and underscores
        },
        message: "Document key must contain only uppercase letters and underscores",
      },
    },
    title: { type: String, required: true },
    category: {
      type: String,
      enum: ["ONBOARDING", "COMPLIANCE", "LEGAL", "GENERAL"],
      required: true,
      index: true,
    },
    content: { type: String, required: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model("DocumentTemplate", DocumentTemplateSchema);

