const mongoose = require("mongoose");

const StatementScheduleSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    frequency: {
      type: String,
      enum: ["Monthly", "Fortnightly", "Weekly", "Manual"],
      required: true,
    },
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
      default: null,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 255,
    },
    ccEmails: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSent: {
      type: Date,
      default: null,
    },
    nextScheduled: {
      type: Date,
      default: null,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
StatementScheduleSchema.index({ organizationId: 1, isActive: 1 });
StatementScheduleSchema.index({ organizationId: 1, customerId: 1 });
StatementScheduleSchema.index({ organizationId: 1, nextScheduled: 1 });

// Virtual to populate customer
StatementScheduleSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("StatementSchedule", StatementScheduleSchema);

