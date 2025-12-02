const mongoose = require("mongoose");

const AssignmentSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    paperworkSmsRequested: {
      type: Boolean,
      default: false,
    },
    paperworkSmsSentAt: {
      type: Date,
      default: null,
    },
    startTime: {
      type: Date,
      default: null,
    },
    finishTime: {
      type: Date,
      default: null,
    },
    breakMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index
AssignmentSchema.index({ jobId: 1, driverId: 1 }, { unique: true });

// Virtual to populate job
AssignmentSchema.virtual("job", {
  ref: "Job",
  localField: "jobId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate driver
AssignmentSchema.virtual("driver", {
  ref: "Driver",
  localField: "driverId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Assignment", AssignmentSchema);

