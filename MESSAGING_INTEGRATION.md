# Messaging & Direct Chat Integration Guide

This guide explains how the frontend should integrate with the messaging APIs and Socket.IO events that power channels (creator-only chat rooms) and direct one-on-one conversations.

---

## 1. Authentication

All REST endpoints and socket connections require the standard JWT user token.

```plain
Authorization: Bearer <token>
```

- Keep the token in memory (e.g., Redux store) and attach it to every request.
- For Socket.IO, pass the token either via `auth.token` or `Authorization` header.

```ts
const socket = io(API_BASE_URL, {
  auth: { token: userToken },
  extraHeaders: { Authorization: `Bearer ${userToken}` },
});
```

---

## 2. Channels (Creator-Only Send)

### REST Flow

| Action | Method & Path | Notes |
| --- | --- | --- |
| Create channel | `POST /api/v1/messages/channels` | `members` array contains additional user IDs. Only creator can send messages. |
| List channels | `GET /api/v1/messages/channels?search=&starred=false` | Filter by search or starred flag. |
| Channel detail | `GET /api/v1/messages/channels/:channelId` | User must be creator or member. |
| Add/remove members | `POST/DELETE /api/v1/messages/channels/:channelId/members` | Creator only. Payload uses `memberIds`. |
| Toggle star | `POST /api/v1/messages/channels/:channelId/star` | Any member can star/unstar. |
| Send message | `POST /api/v1/messages/channels/:channelId/messages` | **Creator only can send**; others will get 403. |
| Get messages | `GET /api/v1/messages/channels/:channelId/messages?page=1&limit=50` | Returns messages in chronological order. |
| Update/Delete message | `PATCH/DELETE /api/v1/messages/messages/:messageId` | Sender only; soft delete. |

### UI Expectations

- Show a “read-only” state for members who are not the creator (disable composer, show tooltip “Only creator can post”).
- Keep track of `channel.lastMessage` and `lastMessageAt` coming from REST or socket updates for active list ordering.

### Socket Events (Channels)

| Event | Direction | Payload / Notes |
| --- | --- | --- |
| `joinChannel` / `leaveChannel` | client → server | Provide `channelId` to join/leave rooms. Run on channel open/close. |
| `sendMessage` | client → server | `{ channelId, content, messageType?, attachments? }` creator only. |
| `newMessage` | server → client | Broadcast in `channel:{id}`; payload includes populated sender. |
| `messageUpdated` / `messageDeleted` | server → client | Mirror updates/deletions. |
| `channelUpdate` | server → client | Emits to each member’s `user:{id}` room when last message changes. |
| `typing` / `stopTyping` | both ways | Payload should include `channelId`. Server emits `userTyping` / `userStopTyping`. |

---

## 3. Direct Conversations (One-on-One)

### REST Flow

| Action | Method & Path | Notes |
| --- | --- | --- |
| Start conversation | `POST /api/v1/messages/conversations` | Body `{ "recipientId": "<userId>" }`. Returns existing conversation if already created. |
| List conversations | `GET /api/v1/messages/conversations?search=&includeArchived=false` | Automatically sorted by last activity. Use search for filtering by participant name/email/username. |
| Get conversation | `GET /api/v1/messages/conversations/:conversationId` | Includes participants & lastMessage info. |
| Send message | `POST /api/v1/messages/conversations/:conversationId/messages` | Both participants can send. |
| Get messages | `GET /api/v1/messages/conversations/:conversationId/messages?page=1&limit=50` | Includes pagination + conversation metadata. |

### UI Expectations

- Store conversation list separately from channels.
- Use `conversation.participants` to derive the “other” user (filter out the logged-in user ID).
- When sending a new DM from a profile card: call **Start conversation** first to get `conversationId`, then send messages via the conversation endpoint.
- Conversations auto-unarchive when a new message arrives.

### Socket Events (Conversations)

| Event | Direction | Payload / Notes |
| --- | --- | --- |
| `joinConversation` / `leaveConversation` | client → server | Provide `conversationId` to join/leave DM rooms. Call when opening/closing a thread. |
| `sendConversationMessage` | client → server | `{ conversationId, content, messageType?, attachments? }`. |
| `conversation:newMessage` | server → client | Broadcast to `conversation:{id}` room. |
| `conversation:update` | server → client | Emitted to both participants (`user:{id}` rooms) whenever last message changes. |
| `conversation:messageUpdated` / `conversation:messageDeleted` | server → client | Mirror message changes. |
| `conversation:userTyping` / `conversation:userStopTyping` | server → client | Typing indicators for DM threads via `typing`/`stopTyping` payload with `conversationId`. |

---

## 4. Socket Bootstrapping Checklist

1. **Connect** with auth token (see §1).
2. On connect:
   - Server auto-joins all channels (creator or member) and conversations for the user.
   - You may still manually call `joinChannel` / `joinConversation` when switching UI context to ensure presence.
3. Keep listeners registered once (e.g., when socket instance created). Suggested mapping:

```ts
socket.on("newMessage", handleChannelMessage);
socket.on("conversation:newMessage", handleConversationMessage);
socket.on("channelUpdate", handleChannelListUpdate);
socket.on("conversation:update", handleConversationListUpdate);
socket.on("userTyping", showChannelTyping);
socket.on("conversation:userTyping", showConversationTyping);
// ...and corresponding stop events
```

4. Emit typing events when the user starts/stops input:

```ts
socket.emit("typing", { channelId });
socket.emit("typing", { conversationId });
```

Remember to debounce these events.

---

## 5. Attachments & Message Types

Both channel and conversation messages use the same payload structure:

```json
{
  "content": "string",
  "messageType": "text | image | file | audio | video",
  "attachments": [
    {
      "url": "https://cdn.example.com/file.png",
      "fileName": "file.png",
      "fileType": "image/png",
      "fileSize": 12345
    }
  ]
}
```

- `messageType` defaults to `text`.
- Upload files via existing `/upload-*` endpoints first, then reference the returned URL in `attachments`.

---

## 6. Postman Collection

The repo’s `Transporter_API.postman_collection.json` now contains:
- **Channels** folder (existing).
- **Conversations** folder for all REST flows.
- Collection variables: `channelId`, `messageId`, `conversationId`.

Import/refresh the collection to explore sample requests quickly.

---

## 7. Error Handling & UX Tips

- Show `403` errors as permission warnings (“Only channel creator can post”, “You’re not part of this conversation”).
- On `404` for conversation/chat, prompt to refresh list or re-initiate DM.
- Handle socket disconnects by showing “Reconnecting…” UI and rejoining active rooms once connected.
- Optimistic UI updates: append pending message locally, replace when server ack arrives (`messageSent` / `conversationMessageSent`).

---

## 8. Quick Reference (Endpoints)

```plain
POST   /api/v1/messages/channels
GET    /api/v1/messages/channels
GET    /api/v1/messages/channels/:channelId
PATCH  /api/v1/messages/channels/:channelId
DELETE /api/v1/messages/channels/:channelId
POST   /api/v1/messages/channels/:channelId/members
DELETE /api/v1/messages/channels/:channelId/members
POST   /api/v1/messages/channels/:channelId/star
POST   /api/v1/messages/channels/:channelId/messages
GET    /api/v1/messages/channels/:channelId/messages

POST   /api/v1/messages/conversations
GET    /api/v1/messages/conversations
GET    /api/v1/messages/conversations/:conversationId
POST   /api/v1/messages/conversations/:conversationId/messages
GET    /api/v1/messages/conversations/:conversationId/messages
```

---

Need backend assistance or new UI hooks? Reach out in `#backend-support` before building new flows.

