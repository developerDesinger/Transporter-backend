const express = require("express");
const MessageController = require("../controller/MessageController");
const { isAuthenticated } = require("../middlewares/auth.middleware");

const router = express.Router();

// All routes require authentication
router.use(isAuthenticated);

// Channel routes
router.post("/channels", MessageController.createChannel);
router.get("/channels", MessageController.getChannels);
router.get("/channels/:channelId", MessageController.getChannel);
router.patch("/channels/:channelId", MessageController.updateChannel);
router.delete("/channels/:channelId", MessageController.deleteChannel);
router.post("/channels/:channelId/members", MessageController.addMembers);
router.delete("/channels/:channelId/members", MessageController.removeMembers);
router.post("/channels/:channelId/star", MessageController.toggleStarChannel);

// Conversation routes
router.post("/conversations", MessageController.createConversation);
router.get("/conversations", MessageController.getConversations);
router.get("/conversations/:conversationId", MessageController.getConversation);
router.post(
  "/conversations/:conversationId/messages",
  MessageController.sendConversationMessage
);
router.get(
  "/conversations/:conversationId/messages",
  MessageController.getConversationMessages
);

// Message routes
router.post("/channels/:channelId/messages", MessageController.sendMessage);
router.get("/channels/:channelId/messages", MessageController.getMessages);
router.patch("/messages/:messageId", MessageController.updateMessage);
router.delete("/messages/:messageId", MessageController.deleteMessage);

// Direct message routes
router.get("/direct-messages/:userId", MessageController.getDirectMessages);

module.exports = router;

