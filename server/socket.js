async function getUser(pool, userId) {
  const result = await pool.query(
    `
      SELECT id, username
      FROM users
      WHERE id = $1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

const {
  parseConversationId,
  isConversationMember,
  getConversationMessages,
} = require("./conversations");

async function getRecentMessages(pool, conversationId, limit = 100) {
  const result = await pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.content,
        m.reply_to_message_id,
        m.created_at,
        m.edited_at,
        m.deleted_at,
        u.id AS user_id,
        u.username,

        reply.content AS reply_content,
        reply_user.username AS reply_username

      FROM messages m

      JOIN users u
        ON u.id = m.user_id

      LEFT JOIN messages reply
        ON reply.id = m.reply_to_message_id

      LEFT JOIN users reply_user
        ON reply_user.id = reply.user_id

      WHERE m.conversation_id = $1

      ORDER BY m.created_at DESC

      LIMIT $2
    `,
    [conversationId, limit]
  );

  return result.rows.reverse();
}

async function getMessageCount(pool, conversationId) {
  const result = await pool.query(
    `
    SELECT COUNT(*)::integer AS count 
    FROM messages
    WHERE deleted_at IS NULL
      AND conversation_id = $1
    `,
    [conversationId]
  );

  return result.rows[0].count;
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

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function setupSocket(io, pool) {
  const onlineUsers = new Map();

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

  io.on("connection", async (socket) => {
    const userId = socket.user.id;

    console.log(`${socket.user.username} connected.`);

    const previousConnections =
      onlineUsers.get(userId)?.connections || 0;

    onlineUsers.set(userId, {
      username: socket.user.username,
      connections: previousConnections + 1,
    });

    /*
     * Send the complete online-user list.
     */
    const onlineUsersList = Array.from(
      onlineUsers.entries()
    ).map(([id, user]) => ({
      id: Number(id),
      username: user.username,
    }));

    socket.emit("users:online", onlineUsersList);

    /*
     * Tell everyone else that this user came online.
     */
    if (previousConnections === 0) {
      socket.broadcast.emit("user:online", {
        id: socket.user.id,
        username: socket.user.username,
      });
    }

    const memberConversations = await pool.query(
      `SELECT conversation_id FROM conversation_members WHERE user_id = $1`,
      [userId],
    );

    for (const row of memberConversations.rows) {
      await socket.join(conversationRoom(row.conversation_id));
    }

    socket.on("conversation:join", async (value, acknowledge) => {
      const conversationId = parseConversationId(
        typeof value === "object" ? value?.conversationId : value,
      );

      if (!conversationId) {
        acknowledge?.({ error: "Invalid conversation ID." });
        return;
      }

      if (!(await isConversationMember(pool, conversationId, userId))) {
        acknowledge?.({ error: "You are not a member of this conversation." });
        return;
      }

      await socket.join(conversationRoom(conversationId));

      try {
        const messages = await getRecentMessages(pool, conversationId);
        const messageCount = await getMessageCount(pool, conversationId);

        socket.emit("chat:history", { conversationId, messages });
        socket.emit("messages:count", { conversationId, count: messageCount });
        acknowledge?.({ success: true, conversationId });
      } catch (error) {
        console.error("Failed to load conversation data:", error);
        acknowledge?.({ error: "Could not load conversation." });
      }
    });

    socket.on("conversation:leave", (value) => {
      const conversationId = parseConversationId(
        typeof value === "object" ? value?.conversationId : value,
      );

      if (conversationId) {
        socket.leave(conversationRoom(conversationId));
      }
    });

    /*
     * Send a message.
     */
    socket.on("chat:send", async (data) => {
    try {
      if (!allowEvent(socket, "chat:send", 30, 60 * 1000)) {
      socket.emit("chat:error", {
        error: "You are sending messages too quickly.",
      });
      return;
      }

        const conversationId = parseConversationId(data?.conversationId);

        if (!conversationId || !(await isConversationMember(pool, conversationId, socket.user.id))) {
        socket.emit("chat:error", { error: "You are not a member of this conversation." });
        return;
        }

        if (
        !data ||
        typeof data.content !== "string"
        ) {
        return;
        }

        const content = data.content.trim().normalize("NFC");

        // Empty or excessively long messages
        if (
        !content ||
        content.length > 2000 ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)
        ) {
        return;
        }

        /*
        * Determine whether this is a reply.
        */
        let replyTo = null;

        if (
        data.replyToMessageId !== null &&
        data.replyToMessageId !== undefined
        ) {
        const replyId =
            Number(data.replyToMessageId);

        if (
            Number.isInteger(replyId) &&
            replyId > 0
        ) {
            replyTo = replyId;
        }
        }

        /*
        * Make sure the message being replied to
        * actually exists and hasn't been deleted.
        */
        if (replyTo !== null) {
        const replyCheck =
            await pool.query(
            `
                SELECT id
                FROM messages
                WHERE id = $1
                AND deleted_at IS NULL
                AND conversation_id = $2
            `,
              [replyTo, conversationId]
            );

        if (replyCheck.rowCount === 0) {
            replyTo = null;
        }
        }

        /*
        * Insert the new message.
        */
        const result =
        await pool.query(
            `
            INSERT INTO messages
                (
                user_id,
                conversation_id,
                content,
                reply_to_message_id
                )
            VALUES
              ($1, $2, $3, $4)

            RETURNING
                id,
                conversation_id,
                content,
                reply_to_message_id,
                created_at,
                edited_at,
                deleted_at
            `,
            [
            socket.user.id,
            conversationId,
            content,
            replyTo,
            ]
        );

        const message = {
        ...result.rows[0],

        user_id:
            socket.user.id,

        username:
            socket.user.username,

        reply_content: null,

        reply_username: null,
        };

        /*
        * If this is a reply, get the original
        * message's content and username.
        */
        if (replyTo !== null) {
        const replyResult =
            await pool.query(
            `
                SELECT
                m.content,
                u.username

                FROM messages m

                JOIN users u
                ON u.id = m.user_id

                WHERE m.id = $1
                AND m.deleted_at IS NULL
            `,
            [replyTo]
            );

        if (replyResult.rowCount > 0) {
            message.reply_content =
            replyResult.rows[0].content;

            message.reply_username =
            replyResult.rows[0].username;
        }
        }

        /*
        * Send the new message to everyone
        * connected to the chat.
        */
        io.to(conversationRoom(conversationId)).emit(
        "chat:message",
        message
        );

        /*
        * Get the lifetime message count.
        */

        /*
        * Get the current visible message count.
        */
        const messageCount =
        await getMessageCount(pool, conversationId);

        /*
        * Update the counter for everyone.
        */
        io.to(conversationRoom(conversationId)).emit(
        "messages:count",
        { conversationId, count: messageCount }
        );

    } catch (error) {
        console.error(
        "Message error:",
        error
        );

        socket.emit(
        "chat:error",
        {
            error:
            "Could not send message.",
        }
        );
    }
    });

    /*
    * Edit a message.
    */
    socket.on("chat:edit", async (data) => {
    try {
      if (!allowEvent(socket, "chat:edit", 20, 60 * 1000)) {
      socket.emit("chat:error", {
        error: "Too many edits. Try again shortly.",
      });
      return;
      }

        if (!data) {
        return;
        }

        const messageId =
        Number(data.messageId);

        const content =
        typeof data.content === "string"
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

        /*
        * Only the original sender can edit.
        */
        const result = await pool.query(
        `
            UPDATE messages

            SET
            content = $1,
            edited_at = NOW()

            WHERE
            id = $2
            AND user_id = $3
            AND deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM conversation_members
              WHERE conversation_id = messages.conversation_id
                AND user_id = $3
            )

            RETURNING
            id,
            conversation_id,
            content,
            reply_to_message_id,
            created_at,
            edited_at,
            deleted_at
        `,
        [
            content,
            messageId,
            socket.user.id,
        ]
        );

        if (result.rowCount === 0) {
        return;
        }

        const updatedMessage =
        result.rows[0];

        /*
        * Get reply information again.
        */
        let replyContent = null;
        let replyUsername = null;

        if (
        updatedMessage.reply_to_message_id
        ) {
        const replyResult =
            await pool.query(
            `
                SELECT
                m.content,
                m.deleted_at,
                u.username

                FROM messages m

                JOIN users u
                ON u.id = m.user_id

                WHERE m.id = $1
            `,
            [
                updatedMessage.reply_to_message_id,
            ]
            );

        if (replyResult.rowCount > 0) {
            replyContent =
            replyResult.rows[0].deleted_at
                ? "Message deleted"
                : replyResult.rows[0].content;

            replyUsername =
            replyResult.rows[0].username;
        }
        }

        io.to(conversationRoom(updatedMessage.conversation_id)).emit("chat:edited", {
        ...updatedMessage,

        user_id: socket.user.id,
        username: socket.user.username,

        reply_content: replyContent,
        reply_username: replyUsername,
        });

    } catch (error) {
        console.error(
        "Edit message error:",
        error
        );
    }
    });

    /*
    * Delete a message.
    */
    socket.on("chat:delete", async (data) => {
    try {
      if (!allowEvent(socket, "chat:delete", 20, 60 * 1000)) {
      socket.emit("chat:error", {
        error: "Too many delete requests. Try again shortly.",
      });
      return;
      }

        if (!data) {
        return;
        }

        const messageId =
        Number(data.messageId);

        if (
        !Number.isInteger(messageId) ||
        messageId <= 0
        ) {
        return;
        }

        /*
        * Only the original sender can delete.
        */
        const result = await pool.query(
        `
            UPDATE messages

            SET
            content = '',
            deleted_at = NOW()

            WHERE
            id = $1
            AND user_id = $2
            AND deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM conversation_members
              WHERE conversation_id = messages.conversation_id
                AND user_id = $2
            )

            RETURNING
            id,
            conversation_id,
            reply_to_message_id,
            created_at,
            edited_at,
            deleted_at
        `,
        [
            messageId,
            socket.user.id,
        ]
        );

        if (result.rowCount === 0) {
        return;
        }

        /*
        * Tell everyone that the message was deleted.
        */
        io.to(conversationRoom(result.rows[0].conversation_id)).emit("chat:deleted", {
        id: result.rows[0].id,
        user_id: socket.user.id,
        deleted_at:
            result.rows[0].deleted_at,
        });

        /*
        * Recalculate the visible message count.
        */
        const messageCount =
        await getMessageCount(pool, result.rows[0].conversation_id);

        /*
        * Update the counter for everyone immediately.
        */
        io.to(conversationRoom(result.rows[0].conversation_id)).emit(
        "messages:count",
        { conversationId: result.rows[0].conversation_id, count: messageCount }
        );

    } catch (error) {
        console.error(
        "Delete message error:",
        error
        );
    }
    });

    /*
     * Typing indicator.
     */
    socket.on("typing:start", async (value) => {
      if (!allowEvent(socket, "typing:start", 30, 10 * 1000)) {
        return;
      }

      const conversationId = parseConversationId(
        typeof value === "object" ? value?.conversationId : value,
      );

      if (!conversationId || !(await isConversationMember(pool, conversationId, socket.user.id))) {
        return;
      }

      socket.to(conversationRoom(conversationId)).emit("user:typing", {
        id: socket.user.id,
        username: socket.user.username,
      });
    });

    socket.on("typing:stop", (value) => {
      const conversationId = parseConversationId(
        typeof value === "object" ? value?.conversationId : value,
      );

      if (!conversationId) {
        return;
      }

      socket.to(conversationRoom(conversationId)).emit(
        "user:stopped-typing",
        {
          id: socket.user.id,
          username: socket.user.username,
        }
      );
    });

    /*
     * Disconnect.
     */
    socket.on("disconnect", () => {
      const userInfo = onlineUsers.get(userId);

      if (!userInfo) {
        return;
      }

      userInfo.connections--;

      if (userInfo.connections <= 0) {
        onlineUsers.delete(userId);

        socket.broadcast.emit(
          "user:offline",
          {
            id: socket.user.id,
            username: socket.user.username,
          }
        );
      } else {
        onlineUsers.set(userId, userInfo);
      }

      console.log(
        `${socket.user.username} disconnected.`
      );
    });
  });
}

module.exports = setupSocket;