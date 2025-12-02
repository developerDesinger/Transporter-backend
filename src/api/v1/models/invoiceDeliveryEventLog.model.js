const mongoose = require("mongoose");

const LOG_EVENT_TYPES = [
  "SENT",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "BOUNCED",
  "RESENT_REQUESTED",
  "RESENT_SENT",
  "WEBHOOK_RECEIVED",
];

const InvoiceDeliveryEventLogSchema = new mongoose.Schema(
  {
    deliveryEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceDeliveryEvent",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    eventType: {
      type: String,
      enum: LOG_EVENT_TYPES,
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    providerPayload: {
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

InvoiceDeliveryEventLogSchema.index({ deliveryEventId: 1, timestamp: -1 });

module.exports = mongoose.model("InvoiceDeliveryEventLog", InvoiceDeliveryEventLogSchema);

