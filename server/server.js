const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Server } = require("socket.io");

require("dotenv").config();

const { pool, initializeDatabase } = require("./database");
const {
  authenticateWithCode,
  setUsername,
  verifyUserAccessCode,
} = require("./auth");
const {
  GENERAL_NAME,
  parseConversationId,
  ensureGeneralMember,
  createConversation,
  getUserConversations,
  getConversationMembers,
  addMember,
  removeMember,
  isConversationMember,
  findPrivateConversation,
  getConversation,
  deleteConversationIfEmpty,
  getConversationMessages,
  markConversationRead,
} = require("./conversations");
const setupSocket = require("./socket");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const io = new Server(server);

const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be configured.");
}

if (
  process.env.NODE_ENV === "production" &&
  process.env.SESSION_SECRET.length < 32
) {
  throw new Error("Production SESSION_SECRET must be at least 32 characters.");
}

app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many account changes. Try again later." },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many searches. Try again later." },
});

const sessionMiddleware = session({
  store: new pgSession({
    pool,
    tableName: "sessions",
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
});

app.use(sessionMiddleware);

// Give Socket.IO access to the same login session.
io.engine.use(sessionMiddleware);

app.post("/api/login", loginLimiter, async (req, res) => {
  try {
    const { accessCode } = req.body;

    if (!accessCode) {
      return res.status(400).json({
        error: "Access code is required.",
      });
    }

    const user = await authenticateWithCode(accessCode);

    if (!user) {
      return res.status(401).json({
        error: "Invalid access code.",
      });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }

        req.session.userId = user.id;
        resolve();
      });
    });

    res.json({
      success: true,
      needsUsername: user.needsUsername,
      username: user.username,
      userId: user.id,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      error: "Something went wrong.",
    });
  }
});

app.post("/api/setup-username", accountLimiter, async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        error: "You are not logged in.",
      });
    }

    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        error: "Username is required.",
      });
    }

    const user = await setUsername(
      req.session.userId,
      username
    );

    await ensureGeneralMember(pool, req.session.userId);

    res.json({
      success: true,
      username: user.username,
    });
  } catch (error) {
    console.error("Username setup error:", error);

    res.status(400).json({
      error: error.message,
    });
  }
});

function requireSessionUser(req, res) {
  if (!req.session.userId) {
    res.status(401).json({ error: "You are not logged in." });
    return null;
  }

  return req.session.userId;
}

async function requireConversationMember(req, res) {
  const userId = requireSessionUser(req, res);

  if (!userId) {
    return null;
  }

  const conversationId = parseConversationId(req.params.id || req.query.conversationId);

  if (!conversationId) {
    res.status(400).json({ error: "Invalid conversation ID." });
    return null;
  }

  if (!(await isConversationMember(pool, conversationId, userId))) {
    res.status(403).json({ error: "You are not a member of this conversation." });
    return null;
  }

  return { userId, conversationId };
}

app.get("/api/users", async (req, res) => {
  const userId = requireSessionUser(req, res);

  if (!userId) {
    return;
  }

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const result = await pool.query(
    `
      SELECT id, username
      FROM users
      WHERE id <> $1
        AND username IS NOT NULL
        AND ($2 = '' OR username ILIKE $3)
      ORDER BY username ASC
      LIMIT 50
    `,
    [userId, query, `%${query}%`],
  );

  res.json({ users: result.rows });
});

app.get("/api/conversations", async (req, res) => {
  const userId = requireSessionUser(req, res);

  if (!userId) {
    return;
  }

  await ensureGeneralMember(pool, userId);
  res.json({ conversations: await getUserConversations(pool, userId) });
});

app.get("/api/conversations/:id/members", async (req, res) => {
  const access = await requireConversationMember(req, res);

  if (!access) {
    return;
  }

  res.json({ members: await getConversationMembers(pool, access.conversationId) });
});

app.post("/api/conversations", async (req, res) => {
  const userId = requireSessionUser(req, res);

  if (!userId) {
    return;
  }

  const rawMemberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  const memberIds = [...new Set(rawMemberIds.map(Number))].filter(
    (memberId) => Number.isInteger(memberId) && memberId > 0 && memberId !== userId,
  );

  if (memberIds.length === 0) {
    return res.status(400).json({ error: "Select at least one other user." });
  }

  const users = await pool.query(
    `SELECT id FROM users WHERE id = ANY($1::int[]) AND username IS NOT NULL`,
    [memberIds],
  );

  if (users.rowCount !== memberIds.length) {
    return res.status(400).json({ error: "One or more selected users are invalid." });
  }

  if (memberIds.length === 1) {
    const existing = await findPrivateConversation(pool, userId, memberIds[0]);

    if (existing) {
      return res.json({ conversation: existing, existing: true });
    }
  }

  const isGroup = memberIds.length > 1;
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

  if (isGroup && (!name || name.length > 100)) {
    return res.status(400).json({ error: "A group name between 1 and 100 characters is required." });
  }

  if (name === GENERAL_NAME) {
    return res.status(400).json({ error: "That conversation name is reserved." });
  }

  const conversation = await createConversation(pool, {
    name,
    isGroup,
    createdBy: userId,
    memberIds,
  });

  res.status(201).json({ conversation, existing: false });
});

app.post("/api/conversations/:id/members", async (req, res) => {
  const access = await requireConversationMember(req, res);

  if (!access) {
    return;
  }

  const conversation = await getConversation(pool, access.conversationId);
  const userId = Number(req.body.userId);

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found." });
  }

  if (!conversation.is_group) {
    return res.status(400).json({ error: "Private conversations cannot add members." });
  }

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  const user = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND username IS NOT NULL`,
    [userId],
  );

  if (user.rowCount === 0) {
    return res.status(404).json({ error: "User not found." });
  }

  const membership = await addMember(pool, access.conversationId, userId);

  if (!membership) {
    return res.status(409).json({ error: "User is already a member or conversation is invalid." });
  }

  const connectedSockets = await io.fetchSockets();

  for (const connectedSocket of connectedSockets) {
    if (Number(connectedSocket.user?.id) === userId) {
      await connectedSocket.join(`conversation:${access.conversationId}`);
    }
  }

  res.status(201).json({ member: membership });
});

app.delete("/api/conversations/:id/members/me", async (req, res) => {
  const access = await requireConversationMember(req, res);

  if (!access) {
    return;
  }

  const removed = await removeMember(pool, access.conversationId, access.userId);

  if (!removed) {
    return res.status(400).json({ error: "You cannot leave General." });
  }

  const connectedSockets = await io.fetchSockets();

  for (const connectedSocket of connectedSockets) {
    if (Number(connectedSocket.user?.id) === Number(access.userId)) {
      connectedSocket.leave(`conversation:${access.conversationId}`);
    }
  }

  await deleteConversationIfEmpty(pool, access.conversationId);
  res.json({ success: true });
});

app.get("/api/conversations/:id/messages", async (req, res) => {
  const access = await requireConversationMember(req, res);

  if (!access) {
    return;
  }

  res.json({ messages: await getConversationMessages(pool, access.conversationId) });
});

app.post("/api/conversations/:id/read", async (req, res) => {
  const access = await requireConversationMember(req, res);

  if (!access) {
    return;
  }

  const messageId = Number(req.body.messageId);

  if (!Number.isInteger(messageId) || messageId <= 0) {
    return res.status(400).json({ error: "Invalid message ID." });
  }

  const message = await pool.query(
    `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2`,
    [messageId, access.conversationId],
  );

  if (message.rowCount === 0) {
    return res.status(400).json({ error: "Message is not in this conversation." });
  }

  await markConversationRead(pool, access.userId, access.conversationId, messageId);
  res.json({ success: true });
});

app.post("/api/change-username", accountLimiter, async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        error: "You are not logged in.",
      });
    }

    const {
      username,
      accessCode,
    } = req.body;

    if (!username || !accessCode) {
      return res.status(400).json({
        error:
          "Username and access code are required.",
      });
    }

    const valid =
      await verifyUserAccessCode(
        req.session.userId,
        accessCode
      );

    if (!valid) {
      return res.status(401).json({
        error: "Incorrect access code.",
      });
    }

    const user = await setUsername(
      req.session.userId,
      username
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
      },
    });

  } catch (error) {
    console.error(
      "Username change error:",
      error
    );

    res.status(400).json({
      error: error.message,
    });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({
        loggedIn: false,
      });
    }

    const result = await pool.query(
      `
        SELECT id, username
        FROM users
        WHERE id = $1
      `,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      req.session.destroy(() => {});

      return res.json({
        loggedIn: false,
      });
    }

    res.json({
      loggedIn: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Session check error:", error);

    res.status(500).json({
      error: "Something went wrong.",
    });
  }
});

app.get("/api/messages/search", searchLimiter, async (req, res) => {
  try {
    const access = await requireConversationMember(req, res);

    if (!access) {
      return;
    }

    const query =
      typeof req.query.q === "string"
        ? req.query.q.trim()
        : "";

    if (!query) {
      return res.json({
        messages: [],
      });
    }

    if (query.length > 200) {
      return res.status(400).json({
        error: "Search query is too long.",
      });
    }

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
          u.username

        FROM messages m

        JOIN users u
          ON u.id = m.user_id

        WHERE
          m.conversation_id = $2
          AND m.deleted_at IS NULL
          AND m.content ILIKE $1

        ORDER BY m.created_at DESC

        LIMIT 500
      `,
      [`%${query}%`, access.conversationId]
    );

    res.json({
      messages: result.rows,
    });
  } catch (error) {
    console.error(
      "Message search error:",
      error
    );

    res.status(500).json({
      error: "Could not search messages.",
    });
  }
});

app.get("/api/messages/context/:id", async (req, res) => {
  try {
    const userId = requireSessionUser(req, res);

    if (!userId) {
      return;
    }

    const messageId =
      Number(req.params.id);

    if (
      !Number.isInteger(messageId) ||
      messageId <= 0
    ) {
      return res.status(400).json({
        error: "Invalid message ID.",
      });
    }

    /*
     * Find the target message's timestamp.
     */
    const targetResult = await pool.query(
      `
        SELECT created_at, conversation_id
        FROM messages
        WHERE id = $1
      `,
      [messageId]
    );

    if (targetResult.rowCount === 0) {
      return res.status(404).json({
        error: "Message not found.",
      });
    }

    const targetTime =
      targetResult.rows[0].created_at;

    const targetConversationId = targetResult.rows[0].conversation_id;

    const requestedConversationId = parseConversationId(req.query.conversationId);

    if (
      requestedConversationId &&
      Number(requestedConversationId) !== Number(targetConversationId)
    ) {
      return res.status(403).json({
        error: "Message does not belong to this conversation.",
      });
    }

    if (!(await isConversationMember(pool, targetConversationId, userId))) {
      return res.status(403).json({
        error: "You are not a member of this conversation.",
      });
    }

    /*
     * The interval approach above isn't actually
     * what we want because timestamps aren't evenly
     * spaced. Get the surrounding messages by ID
     * instead.
     */

    const contextResult = await pool.query(
      `
        WITH target AS (
          SELECT
            id,
            created_at,
            conversation_id
          FROM messages
          WHERE id = $1
        ),

        surrounding AS (
          (
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

            CROSS JOIN target t

            WHERE
              m.conversation_id = t.conversation_id
              AND (
                m.created_at < t.created_at
                OR (m.created_at = t.created_at AND m.id < t.id)
              )

            ORDER BY m.created_at DESC, m.id DESC

            LIMIT 20
          )

          UNION ALL

          (
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

            WHERE m.id = $1
              AND m.conversation_id = $2
          )

          UNION ALL

          (
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

            CROSS JOIN target t

            WHERE
              m.conversation_id = t.conversation_id
              AND (
                m.created_at > t.created_at
                OR (m.created_at = t.created_at AND m.id > t.id)
              )

            ORDER BY m.created_at ASC, m.id ASC

            LIMIT 20
          )
        )

        SELECT *
        FROM surrounding

        ORDER BY created_at ASC
      `,
      [messageId, targetConversationId]
    );

    res.json({
      messages: contextResult.rows,
      targetId: messageId,
    });

  } catch (error) {
    console.error(
      "Message context error:",
      error
    );

    res.status(500).json({
      error: "Could not load message context.",
    });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        error: "Could not log out.",
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      success: true,
    });
  });
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((error, req, res, next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }

  console.error("Unhandled request error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({ error: "Something went wrong." });
});

setupSocket(io, pool);

async function startServer() {
  try {
    await initializeDatabase();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();