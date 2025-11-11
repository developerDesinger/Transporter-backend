const mongoose = require("mongoose");

const AllocatorPreferencesSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    boardType: {
      type: String,
      enum: ["PUD", "LINEHAUL"],
      required: true,
      index: true,
    },
    columnVisibility: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    columnOrder: {
      type: [String],
      default: [],
    },
    zoom: {
      type: Number,
      default: 1.0,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound unique index
AllocatorPreferencesSchema.index({ userId: 1, boardType: 1 }, { unique: true });

// Virtual to populate user
AllocatorPreferencesSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("AllocatorPreferences", AllocatorPreferencesSchema);

