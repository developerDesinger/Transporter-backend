const mongoose = require("mongoose");

const AncillarySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20, // Maximum 20 characters
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    category: {
      type: String,
      enum: ["TRAVEL", "WAITING", "SURCHARGE", "TOLL", "DEMURRAGE"],
      default: null,
    },
    defaultUnit: {
      type: String,
      enum: ["HOUR", "OCCURRENCE", "KM", "EACH", "DAY"],
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: null, // Display order for sorting
    },
    // Multi-tenant support
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for unique code per organization
AncillarySchema.index({ code: 1, organizationId: 1 }, { unique: true });
// Index for sorting
AncillarySchema.index({ organizationId: 1, sortOrder: 1, code: 1 });

module.exports = mongoose.model("Ancillary", AncillarySchema);

