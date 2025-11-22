const mongoose = require("mongoose");

const ClientBroadcastSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      enum: ["EMAIL", "SMS", "BOTH"],
      required: true,
      index: true,
    },
    template: {
      type: String,
      default: null,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["normal", "high", "urgent"],
      default: "normal",
      index: true,
    },
    totalRecipients: {
      type: Number,
      required: true,
      default: 0,
    },
    emailsSent: {
      type: Number,
      required: true,
      default: 0,
    },
    emailsFailed: {
      type: Number,
      required: true,
      default: 0,
    },
    smsSent: {
      type: Number,
      required: true,
      default: 0,
    },
    smsFailed: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: ["SENT", "PENDING", "FAILED", "PARTIAL"],
      default: "PENDING",
      index: true,
    },
    sentByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sentAt: {
      type: Date,
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    filters: {
      states: {
        type: [String],
        default: [],
      },
      workTypes: {
        type: [String],
        default: [],
      },
      cities: {
        type: [String],
        default: [],
      },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes for efficient queries
ClientBroadcastSchema.index({ organizationId: 1, sentAt: -1 });
ClientBroadcastSchema.index({ organizationId: 1, createdAt: -1 });
ClientBroadcastSchema.index({ sentByUserId: 1 });

// Virtual to populate sentByUser
ClientBroadcastSchema.virtual("sentByUser", {
  ref: "User",
  localField: "sentByUserId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("ClientBroadcast", ClientBroadcastSchema);

