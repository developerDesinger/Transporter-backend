const Channel = require("../models/channel.model");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const User = require("../models/user.model");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

const getSocketInstance = () => {
  try {
    const app = require("../../../../app");
    return app.get("io");
  } catch (error) {
    console.error("Socket instance unavailable:", error.message);
    return null;
  }
};

const participantSelectFields =
  "_id fullName email profilePhoto role userName";

const normalizeIds = (ids = []) =>
  ids.map((id) => (typeof id === "string" ? id : id.toString())).sort();

const getParticipantsKey = (ids = []) => normalizeIds(ids).join(":");

const populateConversationDoc = async (conversation) => {
  if (!conversation) return conversation;
  await conversation.populate("participants", participantSelectFields);
  await conversation.populate({
    path: "lastMessage",
    populate: {
      path: "senderId",
      select: participantSelectFields,
    },
  });
  return conversation;
};

class MessageService {
  /**
   * Helper to find or create a direct conversation between two users
   * @param {Array<string|ObjectId>} participantIds
   * @param {string|ObjectId} createdBy
   * @returns {Promise<Conversation>}
   */
  static async findOrCreateConversation(participantIds = [], createdBy) {
    if (participantIds.length !== 2) {
      throw new AppError(
        "Direct conversations must have exactly two participants",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const normalized = normalizeIds(participantIds);
    const participantsKey = getParticipantsKey(participantIds);

    let conversation = await Conversation.findOne({ participantsKey });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: normalized,
        participantsKey,
        createdBy: createdBy || normalized[0],
      });
    } else if (conversation.archivedBy?.length) {
      // Auto-unarchive for participants when conversation is reused
      const updatedArchivedBy = conversation.archivedBy.filter(
        (archivedUserId) =>
          !normalized.includes(
            typeof archivedUserId === "string"
              ? archivedUserId
              : archivedUserId.toString()
          )
      );
      if (updatedArchivedBy.length !== conversation.archivedBy.length) {
        conversation.archivedBy = updatedArchivedBy;
        await conversation.save();
      }
    }

    return populateConversationDoc(conversation);
  }

  /**
   * Create a new channel
   * @param {Object} data - Channel data (name, description, members, isPrivate)
   * @param {Object} user - Authenticated user (creator)
   * @returns {Object} Created channel
   */
  static async createChannel(data, user) {
    const { name, description, members = [], isPrivate = false } = data;

    if (!name || !name.trim()) {
      throw new AppError(
        "Channel name is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate members exist
    if (members && members.length > 0) {
      const validMembers = await User.find({
        _id: { $in: members },
      });
      if (validMembers.length !== members.length) {
        throw new AppError(
          "One or more members are invalid",
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    // Create channel - ensure creator is always in members array
    // Check if creator is already in members to avoid duplicates
    const creatorId = user._id;
    const creatorInMembers = members.some(m => m.toString() === creatorId.toString());
    const allMembers = creatorInMembers ? members : [creatorId, ...members];
    
    const channel = await Channel.create({
      name: name.trim(),
      description: description?.trim(),
      creator: user._id,
      members: allMembers,
      isPrivate: isPrivate,
      organizationId: user.activeOrganizationId,
    });

    // Populate creator and members
    await channel.populate([
      { path: "creator", select: "_id fullName email profilePhoto" },
      { path: "members", select: "_id fullName email profilePhoto" },
    ]);

    return {
      success: true,
      message: "Channel created successfully",
      data: channel,
    };
  }

  /**
   * Get all channels for a user
   * @param {Object} user - Authenticated user
   * @param {Object} query - Query parameters (search, starred)
   * @returns {Object} List of channels
   */
  static async getChannels(user, query = {}) {
    const { search, starred } = query;

    // Build query - user must be creator or member
    const channelQuery = {
      $or: [
        { creator: user._id },
        { members: user._id },
      ],
    };

    // Filter by starred if requested
    if (starred === "true") {
      channelQuery.isStarred = true;
    }

    // Search by name
    if (search) {
      channelQuery.name = { $regex: search, $options: "i" };
    }

    // Filter by organization if user has one
    if (user.activeOrganizationId) {
      channelQuery.$or.push({ organizationId: user.activeOrganizationId });
    }

    const channels = await Channel.find(channelQuery)
      .populate("creator", "_id fullName email profilePhoto")
      .populate("members", "_id fullName email profilePhoto")
      .populate("lastMessage")
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean();

    return {
      success: true,
      message: "Channels retrieved successfully",
      data: channels,
    };
  }

  /**
   * Get a single channel by ID
   * @param {string} channelId - Channel ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Channel details
   */
  static async getChannel(channelId, user) {
    const channel = await Channel.findById(channelId)
      .populate("creator", "_id fullName email profilePhoto")
      .populate("members", "_id fullName email profilePhoto")
      .populate("lastMessage");

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if user is member or creator
    if (!channel.isMember(user._id)) {
      throw new AppError(
        "You don't have access to this channel",
        HttpStatusCodes.FORBIDDEN
      );
    }

    return {
      success: true,
      message: "Channel retrieved successfully",
      data: channel,
    };
  }

  /**
   * Update channel (only creator can update)
   * @param {string} channelId - Channel ID
   * @param {Object} data - Update data
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated channel
   */
  static async updateChannel(channelId, data, user) {
    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only creator can update
    if (!channel.isCreator(user._id)) {
      throw new AppError(
        "Only channel creator can update the channel",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Update allowed fields
    if (data.name) channel.name = data.name.trim();
    if (data.description !== undefined) channel.description = data.description?.trim();
    if (data.isPrivate !== undefined) channel.isPrivate = data.isPrivate;

    // Update members if provided
    if (data.members && Array.isArray(data.members)) {
      // Validate members exist
      const validMembers = await User.find({
        _id: { $in: data.members },
      });
      if (validMembers.length !== data.members.length) {
        throw new AppError(
          "One or more members are invalid",
          HttpStatusCodes.BAD_REQUEST
        );
      }
      channel.members = data.members;
    }

    await channel.save();

    await channel.populate([
      { path: "creator", select: "_id fullName email profilePhoto" },
      { path: "members", select: "_id fullName email profilePhoto" },
    ]);

    return {
      success: true,
      message: "Channel updated successfully",
      data: channel,
    };
  }

  /**
   * Delete channel (only creator can delete)
   * @param {string} channelId - Channel ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async deleteChannel(channelId, user) {
    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only creator can delete
    if (!channel.isCreator(user._id)) {
      throw new AppError(
        "Only channel creator can delete the channel",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Delete all messages in the channel
    await Message.deleteMany({ channelId: channel._id });

    // Delete the channel
    await Channel.findByIdAndDelete(channelId);

    return {
      success: true,
      message: "Channel deleted successfully",
    };
  }

  /**
   * Add members to channel (only creator can add)
   * @param {string} channelId - Channel ID
   * @param {Object} data - Member IDs
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated channel
   */
  static async addMembers(channelId, data, user) {
    const { memberIds } = data;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      throw new AppError(
        "Member IDs array is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only creator can add members
    if (!channel.isCreator(user._id)) {
      throw new AppError(
        "Only channel creator can add members",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Validate members exist
    const validMembers = await User.find({
      _id: { $in: memberIds },
    });
    if (validMembers.length !== memberIds.length) {
      throw new AppError(
        "One or more members are invalid",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Add members (avoid duplicates)
    const existingMemberIds = channel.members.map((id) => id.toString());
    const newMembers = memberIds.filter(
      (id) => !existingMemberIds.includes(id.toString())
    );

    if (newMembers.length > 0) {
      channel.members.push(...newMembers);
      await channel.save();
    }

    await channel.populate([
      { path: "creator", select: "_id fullName email profilePhoto" },
      { path: "members", select: "_id fullName email profilePhoto" },
    ]);

    return {
      success: true,
      message: "Members added successfully",
      data: channel,
    };
  }

  /**
   * Remove members from channel (only creator can remove)
   * @param {string} channelId - Channel ID
   * @param {Object} data - Member IDs
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated channel
   */
  static async removeMembers(channelId, data, user) {
    const { memberIds } = data;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      throw new AppError(
        "Member IDs array is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only creator can remove members
    if (!channel.isCreator(user._id)) {
      throw new AppError(
        "Only channel creator can remove members",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Remove members
    channel.members = channel.members.filter(
      (memberId) => !memberIds.includes(memberId.toString())
    );

    await channel.save();

    await channel.populate([
      { path: "creator", select: "_id fullName email profilePhoto" },
      { path: "members", select: "_id fullName email profilePhoto" },
    ]);

    return {
      success: true,
      message: "Members removed successfully",
      data: channel,
    };
  }

  /**
   * Toggle star status of channel
   * @param {string} channelId - Channel ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated channel
   */
  static async toggleStarChannel(channelId, user) {
    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if user is member or creator
    if (!channel.isMember(user._id)) {
      throw new AppError(
        "You don't have access to this channel",
        HttpStatusCodes.FORBIDDEN
      );
    }

    channel.isStarred = !channel.isStarred;
    await channel.save();

    return {
      success: true,
      message: `Channel ${channel.isStarred ? "starred" : "unstarred"} successfully`,
      data: channel,
    };
  }

  /**
   * Send a message to a channel (only creator can send)
   * @param {string} channelId - Channel ID
   * @param {Object} data - Message data (content, messageType, attachments)
   * @param {Object} user - Authenticated user (sender)
   * @returns {Object} Created message
   */
  static async sendMessage(channelId, data, user) {
    const { content, messageType = "text", attachments = [] } = data;

    if (!content || !content.trim()) {
      throw new AppError(
        "Message content is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if user is member or creator
    if (!channel.isMember(user._id)) {
      throw new AppError(
        "You don't have access to this channel",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Only creator can send messages
    if (!channel.isCreator(user._id)) {
      throw new AppError(
        "Only channel creator can send messages",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Create message
    const message = await Message.create({
      channelId: channel._id,
      senderId: user._id,
      content: content.trim(),
      messageType: messageType,
      attachments: attachments,
    });

    // Update channel's last message
    channel.lastMessage = message._id;
    channel.lastMessageAt = new Date();
    await channel.save();

    // Populate sender
    await message.populate("sender", "_id fullName email profilePhoto");

    // Emit socket event for real-time updates
    // Note: Socket events are handled by the socket service when messages are sent via socket
    // For REST API messages, we'll emit via the app's io instance if available
    const io = getSocketInstance();
    if (io) {
      io.to(`channel:${channelId}`).emit("newMessage", {
        success: true,
        data: message,
      });

      const memberIds = channel.members.map((m) => m.toString());
      memberIds.forEach((memberId) => {
        if (memberId !== user._id.toString()) {
          io.to(`user:${memberId}`).emit("channelUpdate", {
            channelId: channel._id,
            lastMessage: message,
            lastMessageAt: channel.lastMessageAt,
          });
        }
      });
    }

    return {
      success: true,
      message: "Message sent successfully",
      data: message,
    };
  }

  /**
   * Get messages for a channel
   * @param {string} channelId - Channel ID
   * @param {Object} user - Authenticated user
   * @param {Object} query - Query parameters (page, limit)
   * @returns {Object} List of messages
   */
  static async getMessages(channelId, user, query = {}) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    const channel = await Channel.findById(channelId);

    if (!channel) {
      throw new AppError("Channel not found", HttpStatusCodes.NOT_FOUND);
    }

    // Check if user is member or creator
    if (!channel.isMember(user._id)) {
      throw new AppError(
        "You don't have access to this channel",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Get messages (exclude deleted)
    const messages = await Message.find({
      channelId: channel._id,
      isDeleted: false,
    })
      .populate("sender", "_id fullName email profilePhoto")
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    // Mark messages as read for this user
    const messageIds = messages.map((msg) => msg._id);
    await Message.updateMany(
      {
        _id: { $in: messageIds },
        "readBy.userId": { $ne: user._id },
      },
      {
        $push: {
          readBy: {
            userId: user._id,
            readAt: new Date(),
          },
        },
      }
    );

    // Reverse to show oldest first
    messages.reverse();

    return {
      success: true,
      message: "Messages retrieved successfully",
      data: messages,
      pagination: {
        page,
        limit,
        total: await Message.countDocuments({
          channelId: channel._id,
          isDeleted: false,
        }),
      },
    };
  }

  /**
   * Create (or fetch existing) direct conversation with another user
   * @param {string} recipientId
   * @param {Object} user
   * @returns {Object} Conversation payload
   */
  static async createConversation(recipientId, user) {
    if (!recipientId) {
      throw new AppError(
        "Recipient ID is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    if (recipientId.toString() === user._id.toString()) {
      throw new AppError(
        "You cannot start a conversation with yourself",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const recipient = await User.findById(recipientId).select(
      participantSelectFields
    );

    if (!recipient) {
      throw new AppError("Recipient not found", HttpStatusCodes.NOT_FOUND);
    }

    const conversation = await this.findOrCreateConversation(
      [user._id, recipient._id],
      user._id
    );

    return {
      success: true,
      message: "Conversation ready",
      data: conversation,
    };
  }

  /**
   * List conversations for current user
   */
  static async getConversations(user, query = {}) {
    const { search, includeArchived } = query;

    const mongoQuery = {
      participants: user._id,
    };

    if (includeArchived !== "true") {
      mongoQuery.archivedBy = { $ne: user._id };
    }

    let conversations = await Conversation.find(mongoQuery).sort({
      lastMessageAt: -1,
      updatedAt: -1,
    });

    conversations = await Promise.all(
      conversations.map((conversation) => populateConversationDoc(conversation))
    );

    let data = conversations.map((conversation) =>
      conversation.toObject({ virtuals: true })
    );

    if (search) {
      const lowered = search.toLowerCase();
      data = data.filter((conversation) => {
        const otherParticipants = conversation.participants.filter(
          (participant) => participant._id.toString() !== user._id.toString()
        );
        return otherParticipants.some(
          (participant) =>
            participant.fullName?.toLowerCase().includes(lowered) ||
            participant.email?.toLowerCase().includes(lowered) ||
            participant.userName?.toLowerCase().includes(lowered)
        );
      });
    }

    return {
      success: true,
      message: "Conversations retrieved successfully",
      data,
    };
  }

  /**
   * Get single conversation details
   */
  static async getConversation(conversationId, user) {
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError("Conversation not found", HttpStatusCodes.NOT_FOUND);
    }

    if (!conversation.hasParticipant(user._id)) {
      throw new AppError(
        "You are not part of this conversation",
        HttpStatusCodes.FORBIDDEN
      );
    }

    await populateConversationDoc(conversation);

    return {
      success: true,
      message: "Conversation retrieved successfully",
      data: conversation,
    };
  }

  /**
   * Send a direct conversation message
   */
  static async sendConversationMessage(conversationId, data, user) {
    const { content, messageType = "text", attachments = [] } = data;

    if (!content || !content.trim()) {
      throw new AppError(
        "Message content is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError("Conversation not found", HttpStatusCodes.NOT_FOUND);
    }

    if (!conversation.hasParticipant(user._id)) {
      throw new AppError(
        "You are not part of this conversation",
        HttpStatusCodes.FORBIDDEN
      );
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: user._id,
      content: content.trim(),
      messageType,
      attachments,
    });

    conversation.lastMessage = message._id;
    conversation.lastMessageAt = new Date();
    conversation.archivedBy = (conversation.archivedBy || []).filter(
      (archivedUserId) => archivedUserId.toString() !== user._id.toString()
    );
    await conversation.save();

    await message.populate("sender", participantSelectFields);
    await populateConversationDoc(conversation);

    // Emit socket events
    const io = getSocketInstance();
    if (io) {
      io.to(`conversation:${conversationId}`).emit("conversation:newMessage", {
        success: true,
        data: message,
      });

      conversation.participants
        .map((participant) => participant._id || participant)
        .forEach((participantId) => {
          io.to(`user:${participantId}`).emit("conversation:update", {
            conversationId: conversation._id,
            lastMessage: message,
            lastMessageAt: conversation.lastMessageAt,
          });
        });
    }

    return {
      success: true,
      message: "Message sent successfully",
      data: message,
      conversation,
    };
  }

  /**
   * Get conversation messages
   */
  static async getConversationMessages(conversationId, user, query = {}) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const skip = (page - 1) * limit;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new AppError("Conversation not found", HttpStatusCodes.NOT_FOUND);
    }

    if (!conversation.hasParticipant(user._id)) {
      throw new AppError(
        "You are not part of this conversation",
        HttpStatusCodes.FORBIDDEN
      );
    }

    const messages = await Message.find({
      conversationId: conversation._id,
      isDeleted: false,
    })
      .populate("sender", participantSelectFields)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const messageIds = messages.map((msg) => msg._id);
    await Message.updateMany(
      {
        _id: { $in: messageIds },
        "readBy.userId": { $ne: user._id },
      },
      {
        $push: {
          readBy: {
            userId: user._id,
            readAt: new Date(),
          },
        },
      }
    );

    messages.reverse();

    await populateConversationDoc(conversation);

    return {
      success: true,
      message: "Messages retrieved successfully",
      data: messages,
      conversation,
      pagination: {
        page,
        limit,
        total: await Message.countDocuments({
          conversationId: conversation._id,
          isDeleted: false,
        }),
      },
    };
  }

  /**
   * Update a message (only sender can update)
   * @param {string} messageId - Message ID
   * @param {Object} data - Update data (content)
   * @param {Object} user - Authenticated user
   * @returns {Object} Updated message
   */
  static async updateMessage(messageId, data, user) {
    const { content } = data;

    if (!content || !content.trim()) {
      throw new AppError(
        "Message content is required",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const message = await Message.findById(messageId);

    if (!message) {
      throw new AppError("Message not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only sender can update
    if (message.senderId.toString() !== user._id.toString()) {
      throw new AppError(
        "You can only edit your own messages",
        HttpStatusCodes.FORBIDDEN
      );
    }

    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    await message.populate("sender", "_id fullName email profilePhoto");

    return {
      success: true,
      message: "Message updated successfully",
      data: message,
    };
  }

  /**
   * Delete a message (only sender can delete)
   * @param {string} messageId - Message ID
   * @param {Object} user - Authenticated user
   * @returns {Object} Success message
   */
  static async deleteMessage(messageId, user) {
    const message = await Message.findById(messageId);

    if (!message) {
      throw new AppError("Message not found", HttpStatusCodes.NOT_FOUND);
    }

    // Only sender can delete
    if (message.senderId.toString() !== user._id.toString()) {
      throw new AppError(
        "You can only delete your own messages",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Soft delete
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    return {
      success: true,
      message: "Message deleted successfully",
    };
  }

  /**
   * Get direct messages between two users
   * @param {string} userId - Other user ID
   * @param {Object} user - Authenticated user
   * @param {Object} query - Query parameters (page, limit)
   * @returns {Object} List of messages
   */
  static async getDirectMessages(userId, user, query = {}) {
    const recipient = await User.findById(userId);

    if (!recipient) {
      throw new AppError("Recipient not found", HttpStatusCodes.NOT_FOUND);
    }

    const conversation = await this.findOrCreateConversation(
      [user._id, recipient._id],
      user._id
    );

    const response = await this.getConversationMessages(
      conversation._id,
      user,
      query
    );

    response.conversation = conversation;
    return response;
  }
}

module.exports = MessageService;

