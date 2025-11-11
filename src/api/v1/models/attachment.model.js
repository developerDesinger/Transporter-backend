const mongoose = require("mongoose");

const AttachmentSchema = new mongoose.Schema(
  {
    allocatorRowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AllocatorRow",
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Index for allocator row queries
AttachmentSchema.index({ allocatorRowId: 1, createdAt: -1 });

// Virtual to populate allocator row
AttachmentSchema.virtual("allocatorRow", {
  ref: "AllocatorRow",
  localField: "allocatorRowId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Attachment", AttachmentSchema);

