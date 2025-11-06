const mongoose = require("mongoose");

const BillingContactSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    position: {
      type: String,
      default: null,
      trim: true,
    },
    email: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          if (!v || v === "") return true; // Allow empty/null
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Invalid email format",
      },
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    mobile: {
      type: String,
      default: null,
      trim: true,
    },
    isInvoiceReceiver: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Index for efficient queries
BillingContactSchema.index({ customerId: 1, createdAt: -1 });
BillingContactSchema.index({ customerId: 1, isInvoiceReceiver: 1 });

module.exports = mongoose.model("BillingContact", BillingContactSchema);

