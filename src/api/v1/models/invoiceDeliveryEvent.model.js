const mongoose = require("mongoose");

const DELIVERY_STATUSES = ["SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED"];

const InvoiceDeliveryEventSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320,
      index: true,
    },
    recipientName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    sentAt: {
      type: Date,
      required: true,
      index: true,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    openedAt: {
      type: Date,
      default: null,
    },
    clickedAt: {
      type: Date,
      default: null,
    },
    bouncedAt: {
      type: Date,
      default: null,
    },
    firstOpenDelayMinutes: {
      type: Number,
      default: null,
    },
    opensCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    clicksCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastEventAt: {
      type: Date,
      default: null,
    },
    currentStatus: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: "SENT",
      index: true,
    },
    engagementScore: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

InvoiceDeliveryEventSchema.index({ organizationId: 1, sentAt: -1 });
InvoiceDeliveryEventSchema.index({ invoiceId: 1, organizationId: 1 });

InvoiceDeliveryEventSchema.virtual("invoice", {
  ref: "Invoice",
  localField: "invoiceId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("InvoiceDeliveryEvent", InvoiceDeliveryEventSchema);

