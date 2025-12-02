const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "audio", "video"],
      default: "text",
    },
    attachments: [
      {
        url: String,
        fileName: String,
        fileType: String,
        fileSize: Number,
      },
    ],
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Ensure either channelId or conversationId is present
MessageSchema.pre("validate", function (next) {
  if (!this.channelId && !this.conversationId) {
    return next(new Error("Message must belong to a channel or a conversation"));
  }
  next();
});

// Indexes for better query performance
MessageSchema.index({ channelId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
MessageSchema.index({ channelId: 1, isDeleted: 1, createdAt: -1 });

// Virtual to populate sender
MessageSchema.virtual("sender", {
  ref: "User",
  localField: "senderId",
  foreignField: "_id",
  justOne: true,
});

// Virtual to populate channel
MessageSchema.virtual("channel", {
  ref: "Channel",
  localField: "channelId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Message", MessageSchema);

