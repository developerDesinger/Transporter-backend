const mongoose = require("mongoose");

const ChannelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isPrivate: {
      type: Boolean,
      default: false,
    },
    isStarred: {
      type: Boolean,
      default: false,
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    lastMessageAt: {
      type: Date,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
ChannelSchema.index({ creator: 1, createdAt: -1 });
ChannelSchema.index({ members: 1, createdAt: -1 });
ChannelSchema.index({ organizationId: 1, createdAt: -1 });

// Method to check if user is a member
ChannelSchema.methods.isMember = function (userId) {
  const userIdStr = userId.toString();
  
  // Handle populated creator (object with _id) or ObjectId
  const creatorId = this.creator?._id ? this.creator._id.toString() : this.creator?.toString();
  const creatorStr = creatorId || this.creator?.toString();
  
  // Handle populated members (array of objects with _id) or ObjectIds
  const memberIds = this.members.map((id) => {
    return id?._id ? id._id.toString() : id.toString();
  });
  
  return memberIds.includes(userIdStr) || creatorStr === userIdStr;
};

// Virtual to check if user is creator
ChannelSchema.methods.isCreator = function (userId) {
  return this.creator.toString() === userId.toString();
};

module.exports = mongoose.model("Channel", ChannelSchema);

