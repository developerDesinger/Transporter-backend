const mongoose = require("mongoose");

const PaymentAnomalyTimelineSchema = new mongoose.Schema(
  {
    anomalyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentAnomaly",
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    timestamp: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["alert", "progress", "resolved"],
      required: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
PaymentAnomalyTimelineSchema.index({ anomalyId: 1, timestamp: -1 });

// Virtual to populate anomaly
PaymentAnomalyTimelineSchema.virtual("anomaly", {
  ref: "PaymentAnomaly",
  localField: "anomalyId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("PaymentAnomalyTimeline", PaymentAnomalyTimelineSchema);

