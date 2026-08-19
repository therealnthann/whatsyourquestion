const GENERAL_NAME = "General";

function parseConversationId(value) {
  const conversationId = Number(value);

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return null;
  }

  return conversationId;
}

async function getGeneralConversation(pool) {
  const result = await pool.query(
    `
      SELECT id, name, is_group, created_by, created_at
      FROM conversations
      WHERE name = $1 AND is_group = false
      LIMIT 1
    `,
    [GENERAL_NAME],
  );

  return result.rows[0] || null;
}

async function ensureGeneralMember(pool, userId) {
  const general = await getGeneralConversation(pool);

  if (!general) {
    throw new Error("General conversation is not initialized.");
  }

  await pool.query(
    `
      INSERT INTO conversation_members (conversation_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (conversation_id, user_id) DO NOTHING
    `,
    [general.id, userId],
  );

  return general;
}

async function createConversation(pool, { name, isGroup, createdBy, memberIds }) {
  const normalizedMembers = [...new Set([createdBy, ...memberIds.map(Number)])]
    .filter((userId) => Number.isInteger(userId) && userId > 0);

  if (normalizedMembers.length < 2) {
    throw new Error("A conversation needs at least two members.");
  }

  const conversationResult = await pool.query(
    `
      INSERT INTO conversations (name, is_group, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, name, is_group, created_by, created_at
    `,
    [isGroup ? name : null, isGroup, createdBy],
  );

  const conversation = conversationResult.rows[0];

  for (const userId of normalizedMembers) {
    await pool.query(
      `
        INSERT INTO conversation_members (conversation_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (conversation_id, user_id) DO NOTHING
      `,
      [conversation.id, userId],
    );
  }

  return conversation;
}

async function getUserConversations(pool, userId) {
  const result = await pool.query(
    `
      SELECT
        c.id,
        CASE
          WHEN c.name IS NOT NULL THEN c.name
          ELSE private_user.username
        END AS name,
        c.is_group,
        c.created_by,
        c.created_at,
        COUNT(DISTINCT cm_all.user_id)::integer AS member_count,
        latest.id AS latest_message_id,
        latest.content AS latest_message_content,
        latest.created_at AS latest_message_created_at,
        latest.user_id AS latest_message_user_id,
        COALESCE(unread.unread_count, 0)::integer AS unread_count
      FROM conversations c
      JOIN conversation_members cm
        ON cm.conversation_id = c.id
       AND cm.user_id = $1
      JOIN conversation_members cm_all
        ON cm_all.conversation_id = c.id
      LEFT JOIN LATERAL (
        SELECT u.username
        FROM conversation_members private_member
        JOIN users u ON u.id = private_member.user_id
        WHERE private_member.conversation_id = c.id
          AND private_member.user_id <> $1
        LIMIT 1
      ) private_user ON true
      LEFT JOIN LATERAL (
        SELECT id, content, created_at, user_id
        FROM messages
        WHERE conversation_id = c.id AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS unread_count
        FROM messages m
        LEFT JOIN conversation_reads cr
          ON cr.conversation_id = m.conversation_id
         AND cr.user_id = $1
        WHERE m.conversation_id = c.id
          AND m.deleted_at IS NULL
          AND m.user_id != $1
          AND (cr.last_read_message_id IS NULL OR m.id > cr.last_read_message_id)
      ) unread ON true
      GROUP BY c.id, private_user.username, latest.id, unread.unread_count
      ORDER BY (c.name = $2) DESC, latest.created_at DESC NULLS LAST, c.created_at ASC
    `,
    [userId, GENERAL_NAME],
  );

  return result.rows;
}

async function getConversationMessages(pool, conversationId, limit = 100) {
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
      JOIN users u ON u.id = m.user_id
      LEFT JOIN messages reply ON reply.id = m.reply_to_message_id
      LEFT JOIN users reply_user ON reply_user.id = reply.user_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2
    `,
    [conversationId, limit],
  );

  return result.rows.reverse();
}

async function markConversationRead(pool, userId, conversationId, messageId) {
  await pool.query(
    `
      INSERT INTO conversation_reads (user_id, conversation_id, last_read_message_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, conversation_id)
      DO UPDATE SET last_read_message_id = EXCLUDED.last_read_message_id
    `,
    [userId, conversationId, messageId],
  );
}

async function getConversationMembers(pool, conversationId) {
  const result = await pool.query(
    `
      SELECT u.id, u.username, cm.joined_at
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = $1
      ORDER BY u.username ASC, u.id ASC
    `,
    [conversationId],
  );

  return result.rows;
}

async function addMember(pool, conversationId, userId) {
  const result = await pool.query(
    `
      INSERT INTO conversation_members (conversation_id, user_id)
      SELECT $1, $2
      WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = $1 AND is_group = true
      )
      ON CONFLICT (conversation_id, user_id) DO NOTHING
      RETURNING conversation_id, user_id, joined_at
    `,
    [conversationId, userId],
  );

  return result.rows[0] || null;
}

async function removeMember(pool, conversationId, userId) {
  const result = await pool.query(
    `
      DELETE FROM conversation_members cm
      USING conversations c
      WHERE cm.conversation_id = $1
        AND cm.user_id = $2
        AND c.id = cm.conversation_id
        AND NOT (c.name = $3 AND c.is_group = false)
      RETURNING cm.conversation_id, cm.user_id
    `,
    [conversationId, userId, GENERAL_NAME],
  );

  return result.rows[0] || null;
}

async function isConversationMember(pool, conversationId, userId) {
  const result = await pool.query(
    `
      SELECT 1
      FROM conversation_members
      WHERE conversation_id = $1 AND user_id = $2
    `,
    [conversationId, userId],
  );

  return result.rowCount > 0;
}

async function findPrivateConversation(pool, userId, otherUserId) {
  const result = await pool.query(
    `
      SELECT c.id, c.name, c.is_group, c.created_by, c.created_at
      FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
      WHERE c.is_group = false
        AND c.name IS DISTINCT FROM $3
        AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
      LIMIT 1
    `,
    [userId, otherUserId, GENERAL_NAME],
  );

  return result.rows[0] || null;
}

async function getConversation(pool, conversationId) {
  const result = await pool.query(
    `
      SELECT id, name, is_group, created_by, created_at
      FROM conversations
      WHERE id = $1
    `,
    [conversationId],
  );

  return result.rows[0] || null;
}

async function deleteConversationIfEmpty(pool, conversationId) {
  const result = await pool.query(
    `
      DELETE FROM conversations c
      WHERE c.id = $1
        AND NOT (c.name = $2 AND c.is_group = false)
        AND NOT EXISTS (
          SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id
        )
      RETURNING c.id
    `,
    [conversationId, GENERAL_NAME],
  );

  return result.rows[0] || null;
}

module.exports = {
  GENERAL_NAME,
  parseConversationId,
  getGeneralConversation,
  ensureGeneralMember,
  createConversation,
  getUserConversations,
  getConversationMessages,
  markConversationRead,
  getConversationMembers,
  addMember,
  removeMember,
  isConversationMember,
  findPrivateConversation,
  getConversation,
  deleteConversationIfEmpty,
};