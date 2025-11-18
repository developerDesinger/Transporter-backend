const mongoose = require("mongoose");

const DailyNotesSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound unique index: one daily notes entry per organization per date
DailyNotesSchema.index({ organizationId: 1, date: 1 }, { unique: true });

// Index for efficient date range queries
DailyNotesSchema.index({ organizationId: 1, date: -1 });

module.exports = mongoose.model("DailyNotes", DailyNotesSchema);

