const mongoose = require("mongoose");

const CustomerOnboardingTokenSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    used: {
      type: Boolean,
      default: false,
      index: true,
    },
    usedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index for token lookup
CustomerOnboardingTokenSchema.index({ token: 1, used: 1, expiresAt: 1 });
CustomerOnboardingTokenSchema.index({ customerId: 1, email: 1 });

module.exports = mongoose.model("CustomerOnboardingToken", CustomerOnboardingTokenSchema);

