const mongoose = require("mongoose");

const BroadcastSchema = new mongoose.Schema(
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
      enum: ["SENT", "PENDING", "FAILED"],
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
      vehicleTypes: {
        type: [String],
        default: [],
      },
      states: {
        type: [String],
        default: [],
      },
      suburbs: {
        type: [String],
        default: [],
      },
      serviceTypes: {
        type: [String],
        default: [],
      },
      contactTypes: {
        type: [String],
        default: [],
      },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes for efficient queries
BroadcastSchema.index({ organizationId: 1, sentAt: -1 });
BroadcastSchema.index({ organizationId: 1, createdAt: -1 });
BroadcastSchema.index({ sentByUserId: 1 });

// Virtual to populate sentByUser
BroadcastSchema.virtual("sentByUser", {
  ref: "User",
  localField: "sentByUserId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Broadcast", BroadcastSchema);

