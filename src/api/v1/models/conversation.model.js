const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    participantsKey: {
      type: String,
      unique: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    lastMessageAt: {
      type: Date,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    metadata: {
      type: Map,
      of: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Ensure participants are stored in ascending order to enforce uniqueness
ConversationSchema.pre("save", function (next) {
  if (this.participants && this.participants.length > 0) {
    const sorted = this.participants
      .map((id) => id.toString())
      .sort();
    this.participants = sorted.map((id) =>
      mongoose.Types.ObjectId.createFromHexString(id)
    );
    this.participantsKey = sorted.join(":");
  }
  next();
});

// Index to ensure conversation uniqueness regardless of order
ConversationSchema.index({ participantsKey: 1 }, { unique: true });
ConversationSchema.index({ "participants.0": 1, updatedAt: -1 });
ConversationSchema.index({ lastMessageAt: -1 });

ConversationSchema.methods.hasParticipant = function (userId) {
  const userIdStr = userId.toString();
  return this.participants.some((participantId) => participantId.toString() === userIdStr);
};

module.exports = mongoose.model("Conversation", ConversationSchema);


