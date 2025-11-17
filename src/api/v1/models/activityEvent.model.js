const mongoose = require("mongoose");

const ActivityEventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    eventType: {
      type: String,
      default: "update",
      lowercase: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    entityId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
      index: true,
    },
    entityType: {
      type: String,
      enum: ["JOB", "DRIVER", "VEHICLE", "INVOICE", "PAYRUN", "OTHER"],
      default: "JOB",
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ActivityEventSchema.index({
  organizationId: 1,
  eventType: 1,
  timestamp: -1,
});

module.exports = mongoose.model("ActivityEvent", ActivityEventSchema);


