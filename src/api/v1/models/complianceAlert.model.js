const mongoose = require("mongoose");

const ComplianceAlertSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    entityLabel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    entityType: {
      type: String,
      enum: ["DRIVER", "VEHICLE", "JOB"],
      required: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
      lowercase: true,
      index: true,
    },
    detectedAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["OPEN", "ESCALATED", "RESOLVED"],
      default: "OPEN",
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

ComplianceAlertSchema.index({
  organizationId: 1,
  severity: 1,
  entityType: 1,
  status: 1,
});

module.exports = mongoose.model("ComplianceAlert", ComplianceAlertSchema);


