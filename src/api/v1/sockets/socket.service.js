const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Channel = require("../models/channel.model");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");

// Track online users: Map of userId -> Set of socketIds
// This allows multiple tabs/devices per user
const onlineUsers = new Map();

class SocketService {
  /**
   * Initialize socket connection handlers
   * @param {Object} io - Socket.IO instance
   */
  static initialize(io) {
    // Authentication middleware for socket connections (optional for messaging features)
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(" ")[1];
        
        // If token is provided, authenticate
        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select("_id email fullName profilePhoto role");

            if (user) {
              socket.user = user;
            }
          } catch (error) {
            // Invalid token, but allow connection for backward compatibility
            console.warn("Socket authentication failed:", error.message);
          }
        }
        
        next();
      } catch (error) {
        // Allow connection even if auth fails (for backward compatibility)
        console.warn("Socket middleware error:", error.message);
        next();
      }
    });

    io.on("connection", (socket) => {
      // Check if user is authenticated
      if (socket.user) {
        console.log(`User connected: ${socket.user.email} (${socket.id})`);

        const userId = socket.user._id.toString();

        // Track this socket for the user
        if (!onlineUsers.has(userId)) {
          onlineUsers.set(userId, new Set());
        }
        onlineUsers.get(userId).add(socket.id);

        // If this is the first socket for this user, emit online event
        const isFirstConnection = onlineUsers.get(userId).size === 1;
        if (isFirstConnection) {
          // Emit user online event to all clients
          io.emit("userOnline", { userId });
        }

        // Join user's personal room
        socket.join(`user:${socket.user._id}`);

        // Send list of currently online users to the new connection
        const currentlyOnlineUserIds = Array.from(onlineUsers.keys());
        socket.emit("onlineUsersList", { userIds: currentlyOnlineUserIds });

        // Join all channels the user is a member of
        this.joinUserChannels(socket);

        // Join all direct conversations
        this.joinUserConversations(socket);
      } else {
        console.log(`Anonymous client connected: ${socket.id}`);
      }

      // Legacy handler: joinRoom (for backward compatibility)
      socket.on("joinRoom", (userId) => {
        socket.join(userId);
        console.log(`User joined room: ${userId}`);
      });

      // Handle joining a specific channel
      socket.on("joinChannel", async (channelId) => {
        try {
          if (!socket.user) {
            return socket.emit("error", { message: "Authentication required" });
          }

          const channel = await Channel.findById(channelId);
          if (channel && channel.isMember(socket.user._id)) {
            socket.join(`channel:${channelId}`);
            socket.emit("channelJoined", { channelId });
            console.log(`User ${socket.user.email} joined channel ${channelId}`);
          } else {
            socket.emit("error", { message: "Access denied to channel" });
          }
        } catch (error) {
          socket.emit("error", { message: "Failed to join channel" });
        }
      });

      // Handle leaving a channel
      socket.on("leaveChannel", (channelId) => {
        socket.leave(`channel:${channelId}`);
        socket.emit("channelLeft", { channelId });
        console.log(`User ${socket.user.email} left channel ${channelId}`);
      });

      // Handle joining a direct conversation
      socket.on("joinConversation", async (conversationId) => {
        try {
          if (!socket.user) {
            return socket.emit("error", { message: "Authentication required" });
          }

          const conversation = await Conversation.findById(conversationId);
          if (conversation && conversation.hasParticipant(socket.user._id)) {
            socket.join(`conversation:${conversationId}`);
            socket.emit("conversationJoined", { conversationId });
            console.log(
              `User ${socket.user.email} joined conversation ${conversationId}`
            );
          } else {
            socket.emit("error", { message: "Access denied to conversation" });
          }
        } catch (error) {
          socket.emit("error", { message: "Failed to join conversation" });
        }
      });

      socket.on("leaveConversation", (conversationId) => {
        socket.leave(`conversation:${conversationId}`);
        socket.emit("conversationLeft", { conversationId });
      });

      // Handle sending a message (real-time)
      socket.on("sendMessage", async (data) => {
        try {
          // Require authentication for messaging
          if (!socket.user) {
            return socket.emit("error", { message: "Authentication required" });
          }

          const { channelId, content, messageType = "text", attachments = [] } = data;

          if (!channelId || !content) {
            return socket.emit("error", { message: "Channel ID and content are required" });
          }

          const channel = await Channel.findById(channelId);
          if (!channel) {
            return socket.emit("error", { message: "Channel not found" });
          }

          // Check if user is member
          if (!channel.isMember(socket.user._id)) {
            return socket.emit("error", { message: "Access denied to channel" });
          }

          // Only creator can send messages
          if (!channel.isCreator(socket.user._id)) {
            return socket.emit("error", { message: "Only channel creator can send messages" });
          }

          // Create message
          const message = await Message.create({
            channelId: channel._id,
            senderId: socket.user._id,
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

          // Broadcast message to all users in the channel
          io.to(`channel:${channelId}`).emit("newMessage", {
            success: true,
            data: message,
          });

          // Notify channel members (except sender) about new message
          const memberIds = channel.members.map((m) => m.toString());
          memberIds.forEach((memberId) => {
            if (memberId !== socket.user._id.toString()) {
              io.to(`user:${memberId}`).emit("channelUpdate", {
                channelId: channel._id,
                lastMessage: message,
                lastMessageAt: channel.lastMessageAt,
              });
            }
          });

          socket.emit("messageSent", { success: true, messageId: message._id });
        } catch (error) {
          console.error("Error sending message via socket:", error);
          socket.emit("error", { message: "Failed to send message" });
        }
      });

      // Handle sending direct conversation messages
      socket.on("sendConversationMessage", async (data) => {
        try {
          if (!socket.user) {
            return socket.emit("error", { message: "Authentication required" });
          }

          const {
            conversationId,
            content,
            messageType = "text",
            attachments = [],
          } = data;

          if (!conversationId || !content) {
            return socket.emit("error", {
              message: "Conversation ID and content are required",
            });
          }

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) {
            return socket.emit("error", { message: "Conversation not found" });
          }

          if (!conversation.hasParticipant(socket.user._id)) {
            return socket.emit("error", {
              message: "Access denied to conversation",
            });
          }

          const message = await Message.create({
            conversationId: conversation._id,
            senderId: socket.user._id,
            content: content.trim(),
            messageType,
            attachments,
          });

          conversation.lastMessage = message._id;
          conversation.lastMessageAt = new Date();
          await conversation.save();

          await message.populate("sender", "_id fullName email profilePhoto");

          io.to(`conversation:${conversationId}`).emit(
            "conversation:newMessage",
            {
              success: true,
              data: message,
            }
          );

          conversation.participants.forEach((participantId) => {
            io.to(`user:${participantId}`).emit("conversation:update", {
              conversationId: conversation._id,
              lastMessage: message,
              lastMessageAt: conversation.lastMessageAt,
            });
          });

          socket.emit("conversationMessageSent", {
            success: true,
            messageId: message._id,
          });
        } catch (error) {
          console.error("Error sending conversation message via socket:", error);
          socket.emit("error", { message: "Failed to send conversation message" });
        }
      });

      // Handle typing indicator
      socket.on("typing", (data) => {
        const { channelId, conversationId } = data;
        if (channelId) {
          socket.to(`channel:${channelId}`).emit("userTyping", {
            userId: socket.user._id,
            userName: socket.user.fullName,
            channelId: channelId,
          });
        }
        if (conversationId) {
          socket.to(`conversation:${conversationId}`).emit("conversation:userTyping", {
            userId: socket.user._id,
            userName: socket.user.fullName,
            conversationId,
          });
        }
      });

      // Handle stop typing
      socket.on("stopTyping", (data) => {
        const { channelId, conversationId } = data;
        if (channelId) {
          socket.to(`channel:${channelId}`).emit("userStopTyping", {
            userId: socket.user._id,
            channelId: channelId,
          });
        }
        if (conversationId) {
          socket.to(`conversation:${conversationId}`).emit("conversation:userStopTyping", {
            userId: socket.user._id,
            conversationId,
          });
        }
      });

      // Handle message update
      socket.on("updateMessage", async (data) => {
        try {
          const { messageId, content } = data;

          if (!messageId || !content) {
            return socket.emit("error", { message: "Message ID and content are required" });
          }

          const message = await Message.findById(messageId);
          if (!message) {
            return socket.emit("error", { message: "Message not found" });
          }

          // Only sender can update
          if (message.senderId.toString() !== socket.user._id.toString()) {
            return socket.emit("error", { message: "You can only edit your own messages" });
          }

          message.content = content.trim();
          message.isEdited = true;
          message.editedAt = new Date();
          await message.save();

          await message.populate("sender", "_id fullName email profilePhoto");

          if (message.channelId) {
            io.to(`channel:${message.channelId}`).emit("messageUpdated", {
              success: true,
              data: message,
            });
          }

          if (message.conversationId) {
            io
              .to(`conversation:${message.conversationId}`)
              .emit("conversation:messageUpdated", {
                success: true,
                data: message,
              });
          }
        } catch (error) {
          console.error("Error updating message via socket:", error);
          socket.emit("error", { message: "Failed to update message" });
        }
      });

      // Handle message deletion
      socket.on("deleteMessage", async (data) => {
        try {
          const { messageId } = data;

          if (!messageId) {
            return socket.emit("error", { message: "Message ID is required" });
          }

          const message = await Message.findById(messageId);
          if (!message) {
            return socket.emit("error", { message: "Message not found" });
          }

          // Only sender can delete
          if (message.senderId.toString() !== socket.user._id.toString()) {
            return socket.emit("error", { message: "You can only delete your own messages" });
          }

          message.isDeleted = true;
          message.deletedAt = new Date();
          await message.save();

          if (message.channelId) {
            io.to(`channel:${message.channelId}`).emit("messageDeleted", {
              success: true,
              messageId: messageId,
              channelId: message.channelId,
            });
          }

          if (message.conversationId) {
            io
              .to(`conversation:${message.conversationId}`)
              .emit("conversation:messageDeleted", {
                success: true,
                messageId,
                conversationId: message.conversationId,
              });
          }
        } catch (error) {
          console.error("Error deleting message via socket:", error);
          socket.emit("error", { message: "Failed to delete message" });
        }
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        if (socket.user) {
          console.log(`User disconnected: ${socket.user.email} (${socket.id})`);
          const userId = socket.user._id.toString();

          // Remove this socket from the user's socket set
          if (onlineUsers.has(userId)) {
            onlineUsers.get(userId).delete(socket.id);
            
            // If no more sockets for this user, emit offline event
            if (onlineUsers.get(userId).size === 0) {
              onlineUsers.delete(userId);
              // Emit user offline event to all clients
              io.emit("userOffline", { userId });
            }
          }
        } else {
          console.log(`Anonymous client disconnected: ${socket.id}`);
        }
      });
    });
  }

  /**
   * Join all channels the user is a member of
   * @param {Object} socket - Socket instance
   */
  static async joinUserChannels(socket) {
    try {
      const channels = await Channel.find({
        $or: [
          { creator: socket.user._id },
          { members: socket.user._id },
        ],
      }).select("_id");

      channels.forEach((channel) => {
        socket.join(`channel:${channel._id}`);
      });

      console.log(`User ${socket.user.email} joined ${channels.length} channels`);
    } catch (error) {
      console.error("Error joining user channels:", error);
    }
  }

  /**
   * Join all conversations for the user
   */
  static async joinUserConversations(socket) {
    try {
      const conversations = await Conversation.find({
        participants: socket.user._id,
      }).select("_id");

      conversations.forEach((conversation) => {
        socket.join(`conversation:${conversation._id}`);
      });

      console.log(
        `User ${socket.user.email} joined ${conversations.length} conversations`
      );
    } catch (error) {
      console.error("Error joining user conversations:", error);
    }
  }

  /**
   * Emit message to channel
   * @param {Object} io - Socket.IO instance
   * @param {string} channelId - Channel ID
   * @param {Object} message - Message object
   */
  static emitMessage(io, channelId, message) {
    io.to(`channel:${channelId}`).emit("newMessage", {
      success: true,
      data: message,
    });
  }

  /**
   * Emit channel update
   * @param {Object} io - Socket.IO instance
   * @param {string} channelId - Channel ID
   * @param {Object} update - Update data
   */
  static emitChannelUpdate(io, channelId, update) {
    io.to(`channel:${channelId}`).emit("channelUpdate", {
      channelId: channelId,
      ...update,
    });
  }
}

module.exports = SocketService;

