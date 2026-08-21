const {
  getConversationMessages,
  getConversationMessageCount,
  requireConversationMember,
} = require("./conversations");

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

async function getUser(pool, userId) {
  const result = await pool.query(
    `SELECT id, username FROM users WHERE id = $1`,
    [userId],
  );

  return result.rows[0] || null;
}

async function getMessage(pool, messageId, conversationId) {
  const result = await pool.query(
    `
      SELECT
        m.id, m.conversation_id, m.content, m.reply_to_message_id,
        m.created_at, m.edited_at, m.deleted_at,
        u.id AS user_id, u.username,
        reply.content AS reply_content,
        reply_user.username AS reply_username
      FROM messages m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN messages reply
        ON reply.id = m.reply_to_message_id
       AND reply.conversation_id = m.conversation_id
      LEFT JOIN users reply_user ON reply_user.id = reply.user_id
      WHERE m.id = $1 AND m.conversation_id = $2
    `,
    [messageId, conversationId],
  );

  return result.rows[0] || null;
}

function allowEvent(socket, eventName, limit, windowMs) {
  if (!socket.eventTimes) {
    socket.eventTimes = new Map();
  }

  const now = Date.now();
  const recent = (socket.eventTimes.get(eventName) || []).filter(
    (time) => now - time < windowMs,
  );

  if (recent.length >= limit) {
    socket.eventTimes.set(eventName, recent);
    return false;
  }

  recent.push(now);
  socket.eventTimes.set(eventName, recent);
  return true;
}

function sendSocketError(socket, error) {
  socket.emit("chat:error", { error });
}

function setupSocket(io, pool) {
  const onlineUsers = new Map();

  function updateSocketUser(userId, username) {
    for (const socket of io.sockets.sockets.values()) {
      if (Number(socket.user?.id) === Number(userId)) {
        socket.user.username = username;
      }
    }

    const onlineUser = onlineUsers.get(userId);
    if (onlineUser) {
      onlineUser.username = username;
      onlineUsers.set(userId, onlineUser);
    }

    io.emit("user:renamed", { id: userId, username });
  }

  updateSocketUser.notifyConversationUsers = (userIds) => {
    const affectedUsers = new Set(userIds.map((userId) => Number(userId)));

    for (const socket of io.sockets.sockets.values()) {
      if (affectedUsers.has(Number(socket.user?.id))) {
        socket.emit("conversations:updated");
      }
    }
  };

  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      if (!session || !session.userId) {
        return next(new Error("Not authenticated."));
      }

      const user = await getUser(pool, session.userId);
      if (!user || !user.username) {
        return next(new Error("Username not set."));
      }

      socket.user = user;
      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Authentication failed."));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user.id;
    const previousConnections = onlineUsers.get(userId)?.connections || 0;

    onlineUsers.set(userId, {
      username: socket.user.username,
      connections: previousConnections + 1,
    });

    socket.emit(
      "users:online",
      Array.from(onlineUsers.entries()).map(([id, user]) => ({
        id: Number(id),
        username: user.username,
      })),
    );

    if (previousConnections === 0) {
      socket.broadcast.emit("user:online", {
        id: socket.user.id,
        username: socket.user.username,
      });
    }

    socket.on("conversation:join", async (data) => {
      try {
        if (!allowEvent(socket, "conversation:join", 30, 60 * 1000)) {
          sendSocketError(socket, "You are switching conversations too quickly.");
          return;
        }

        const conversationId = await requireConversationMember(
          pool,
          data?.conversationId,
          socket.user.id,
        );
        const conversationResult = await pool.query(
          `
            SELECT id, name, is_group, is_general, created_by, created_at
            FROM conversations
            WHERE id = $1
          `,
          [conversationId],
        );

        if (socket.currentConversationId) {
          socket.leave(conversationRoom(socket.currentConversationId));
        }

        socket.currentConversationId = conversationId;
        await socket.join(conversationRoom(conversationId));

        socket.emit("conversation:joined", conversationResult.rows[0]);
        socket.emit("chat:history", await getConversationMessages(pool, conversationId));
        socket.emit(
          "messages:count",
          await getConversationMessageCount(pool, conversationId),
        );
      } catch (error) {
        sendSocketError(socket, error.message);
      }
    });

    socket.on("chat:send", async (data) => {
      try {
        if (!allowEvent(socket, "chat:send", 30, 60 * 1000)) {
          sendSocketError(socket, "You are sending messages too quickly.");
          return;
        }

        const conversationId = await requireConversationMember(
          pool,
          socket.currentConversationId,
          socket.user.id,
        );
        const content =
          typeof data?.content === "string"
            ? data.content.trim().normalize("NFC")
            : "";

        if (
          !content ||
          content.length > 2000 ||
          /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)
        ) {
          return;
        }

        let replyTo = null;
        const replyId = Number(data?.replyToMessageId);
        if (Number.isInteger(replyId) && replyId > 0) {
          const replyCheck = await pool.query(
            `
              SELECT id FROM messages
              WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL
            `,
            [replyId, conversationId],
          );
          if (replyCheck.rowCount > 0) {
            replyTo = replyId;
          }
        }

        const result = await pool.query(
          `
            INSERT INTO messages
              (user_id, conversation_id, content, reply_to_message_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [socket.user.id, conversationId, content, replyTo],
        );

        const room = conversationRoom(conversationId);
        io.to(room).emit(
          "chat:message",
          await getMessage(pool, result.rows[0].id, conversationId),
        );
        io.to(room).emit(
          "messages:count",
          await getConversationMessageCount(pool, conversationId),
        );
      } catch (error) {
        console.error("Message error:", error);
        sendSocketError(socket, "Could not send message.");
      }
    });

    socket.on("chat:edit", async (data) => {
      try {
        if (!allowEvent(socket, "chat:edit", 20, 60 * 1000)) {
          sendSocketError(socket, "Too many edits. Try again shortly.");
          return;
        }

        const conversationId = await requireConversationMember(
          pool,
          socket.currentConversationId,
          socket.user.id,
        );
        const messageId = Number(data?.messageId);
        const content =
          typeof data?.content === "string"
            ? data.content.trim().normalize("NFC")
            : "";

        if (
          !Number.isInteger(messageId) ||
          messageId <= 0 ||
          !content ||
          content.length > 2000 ||
          /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)
        ) {
          return;
        }

        const result = await pool.query(
          `
            UPDATE messages
            SET content = $1, edited_at = NOW()
            WHERE id = $2 AND conversation_id = $3
              AND user_id = $4 AND deleted_at IS NULL
            RETURNING id
          `,
          [content, messageId, conversationId, socket.user.id],
        );

        if (result.rowCount > 0) {
          io.to(conversationRoom(conversationId)).emit(
            "chat:edited",
            await getMessage(pool, messageId, conversationId),
          );
        }
      } catch (error) {
        console.error("Edit message error:", error);
      }
    });

    socket.on("chat:delete", async (data) => {
      try {
        if (!allowEvent(socket, "chat:delete", 20, 60 * 1000)) {
          sendSocketError(socket, "Too many delete requests. Try again shortly.");
          return;
        }

        const conversationId = await requireConversationMember(
          pool,
          socket.currentConversationId,
          socket.user.id,
        );
        const messageId = Number(data?.messageId);

        if (!Number.isInteger(messageId) || messageId <= 0) {
          return;
        }

        const result = await pool.query(
          `
            UPDATE messages
            SET content = '', deleted_at = NOW()
            WHERE id = $1 AND conversation_id = $2
              AND user_id = $3 AND deleted_at IS NULL
            RETURNING id, deleted_at
          `,
          [messageId, conversationId, socket.user.id],
        );

        if (result.rowCount === 0) {
          return;
        }

        const room = conversationRoom(conversationId);
        io.to(room).emit("chat:deleted", {
          id: result.rows[0].id,
          conversation_id: conversationId,
          user_id: socket.user.id,
          deleted_at: result.rows[0].deleted_at,
        });
        io.to(room).emit(
          "messages:count",
          await getConversationMessageCount(pool, conversationId),
        );
      } catch (error) {
        console.error("Delete message error:", error);
      }
    });

    socket.on("typing:start", async () => {
      if (!allowEvent(socket, "typing:start", 30, 10 * 1000)) {
        return;
      }

      try {
        const conversationId = await requireConversationMember(
          pool,
          socket.currentConversationId,
          socket.user.id,
        );
        socket.to(conversationRoom(conversationId)).emit("user:typing", {
          id: socket.user.id,
          username: socket.user.username,
        });
      } catch {
        // Ignore typing events until a conversation has been joined.
      }
    });

    socket.on("typing:stop", () => {
      if (!socket.currentConversationId) {
        return;
      }

      socket.to(conversationRoom(socket.currentConversationId)).emit(
        "user:stopped-typing",
        {
          id: socket.user.id,
          username: socket.user.username,
        },
      );
    });

    socket.on("disconnect", () => {
      const userInfo = onlineUsers.get(userId);
      if (!userInfo) {
        return;
      }

      userInfo.connections--;
      if (userInfo.connections <= 0) {
        onlineUsers.delete(userId);
        socket.broadcast.emit("user:offline", {
          id: socket.user.id,
          username: socket.user.username,
        });
      } else {
        onlineUsers.set(userId, userInfo);
      }
    });
  });

  return updateSocketUser;
}

module.exports = setupSocket;
