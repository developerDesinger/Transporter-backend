const MessageService = require("../services/message.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");

class MessageController {
  // Channel endpoints
  static createChannel = catchAsyncHandler(async (req, res) => {
    const result = await MessageService.createChannel(req.body, req.user);
    return res.status(201).json(result);
  });

  static getChannels = catchAsyncHandler(async (req, res) => {
    const result = await MessageService.getChannels(req.user, req.query);
    return res.status(200).json(result);
  });

  static getChannel = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.getChannel(channelId, req.user);
    return res.status(200).json(result);
  });

  static updateChannel = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.updateChannel(
      channelId,
      req.body,
      req.user
    );
    return res.status(200).json(result);
  });

  static deleteChannel = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.deleteChannel(channelId, req.user);
    return res.status(200).json(result);
  });

  static addMembers = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.addMembers(
      channelId,
      req.body,
      req.user
    );
    return res.status(200).json(result);
  });

  static removeMembers = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.removeMembers(
      channelId,
      req.body,
      req.user
    );
    return res.status(200).json(result);
  });

  static toggleStarChannel = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.toggleStarChannel(channelId, req.user);
    return res.status(200).json(result);
  });

  // Conversation endpoints
  static createConversation = catchAsyncHandler(async (req, res) => {
    const { recipientId } = req.body;
    const result = await MessageService.createConversation(recipientId, req.user);
    return res.status(201).json(result);
  });

  static getConversations = catchAsyncHandler(async (req, res) => {
    const result = await MessageService.getConversations(req.user, req.query);
    return res.status(200).json(result);
  });

  static getConversation = catchAsyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const result = await MessageService.getConversation(conversationId, req.user);
    return res.status(200).json(result);
  });

  static sendConversationMessage = catchAsyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const result = await MessageService.sendConversationMessage(
      conversationId,
      req.body,
      req.user
    );
    return res.status(201).json(result);
  });

  static getConversationMessages = catchAsyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const result = await MessageService.getConversationMessages(
      conversationId,
      req.user,
      req.query
    );
    return res.status(200).json(result);
  });

  // Message endpoints
  static sendMessage = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.sendMessage(
      channelId,
      req.body,
      req.user
    );
    return res.status(201).json(result);
  });

  static getMessages = catchAsyncHandler(async (req, res) => {
    const { channelId } = req.params;
    const result = await MessageService.getMessages(
      channelId,
      req.user,
      req.query
    );
    return res.status(200).json(result);
  });

  static updateMessage = catchAsyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const result = await MessageService.updateMessage(
      messageId,
      req.body,
      req.user
    );
    return res.status(200).json(result);
  });

  static deleteMessage = catchAsyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const result = await MessageService.deleteMessage(messageId, req.user);
    return res.status(200).json(result);
  });

  // Direct messages
  static getDirectMessages = catchAsyncHandler(async (req, res) => {
    const { userId } = req.params;
    const result = await MessageService.getDirectMessages(
      userId,
      req.user,
      req.query
    );
    return res.status(200).json(result);
  });
}

module.exports = MessageController;

