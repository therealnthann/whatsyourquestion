function normalizeConversationId(value) {
  const id = Number(value);

  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getConversation(pool, conversationId) {
  const result = await pool.query(
    `
      SELECT id, name, is_group, is_general, created_by, created_at
      FROM conversations
      WHERE id = $1
    `,
    [conversationId],
  );

  return result.rows[0] || null;
}

async function isConversationMember(pool, conversationId, userId) {
  const result = await pool.query(
    `
      SELECT 1
      FROM conversation_members
      WHERE conversation_id = $1
        AND user_id = $2
    `,
    [conversationId, userId],
  );

  return result.rowCount > 0;
}

async function requireConversationMember(pool, conversationId, userId) {
  const normalizedId = normalizeConversationId(conversationId);

  if (!normalizedId || !(await isConversationMember(pool, normalizedId, userId))) {
    throw new Error("You are not a member of that conversation.");
  }

  return normalizedId;
}

async function getUserConversations(pool, userId) {
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.name,
        c.is_group,
        c.is_general,
        c.created_by,
        c.created_at,
        CASE
          WHEN c.is_general THEN 'General'
          WHEN c.is_group THEN c.name
          ELSE other_user.username
        END AS display_name,
        other_user.id AS other_user_id,
        other_user.username AS other_username
      FROM conversations c
      JOIN conversation_members member
        ON member.conversation_id = c.id
       AND member.user_id = $1
      LEFT JOIN LATERAL (
        SELECT u.id, u.username
        FROM conversation_members other_member
        JOIN users u ON u.id = other_member.user_id
        WHERE other_member.conversation_id = c.id
          AND other_member.user_id != $1
        ORDER BY other_member.user_id
        LIMIT 1
      ) other_user ON true
      ORDER BY c.is_general DESC, c.created_at ASC, c.id ASC
    `,
    [userId],
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
      LEFT JOIN messages reply
        ON reply.id = m.reply_to_message_id
       AND reply.conversation_id = m.conversation_id
      LEFT JOIN users reply_user ON reply_user.id = reply.user_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2
    `,
    [conversationId, limit],
  );

  return result.rows.reverse();
}

async function getConversationMessageCount(pool, conversationId) {
  const result = await pool.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM messages
      WHERE conversation_id = $1
        AND deleted_at IS NULL
    `,
    [conversationId],
  );

  return result.rows[0].count;
}

async function getNamedUsers(pool, currentUserId) {
  const result = await pool.query(
    `
      SELECT id, username
      FROM users
      WHERE id != $1
        AND username IS NOT NULL
      ORDER BY LOWER(username), id
    `,
    [currentUserId],
  );

  return result.rows;
}

function validateGroupName(name) {
  if (typeof name !== "string") {
    throw new Error("A group name is required.");
  }

  const normalizedName = name.trim().normalize("NFC");

  if (
    normalizedName.length < 1 ||
    normalizedName.length > 100 ||
    /[\u0000-\u001F\u007F]/.test(normalizedName)
  ) {
    throw new Error("Group name must be between 1 and 100 characters.");
  }

  return normalizedName;
}

async function createConversation(pool, creatorId, participantIds, name) {
  const ids = [...new Set(
    participantIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0),
  )];

  if (!ids.includes(Number(creatorId))) {
    ids.push(Number(creatorId));
  }

  if (ids.length < 2) {
    throw new Error("Choose at least one other user.");
  }

  const users = await pool.query(
    `
      SELECT id
      FROM users
      WHERE id = ANY($1::integer[])
        AND username IS NOT NULL
    `,
    [ids],
  );

  if (users.rowCount !== ids.length) {
    throw new Error("One or more selected users are unavailable.");
  }

  const isGroup = ids.length > 2;
  const groupName = isGroup ? validateGroupName(name) : null;

  await pool.query("BEGIN");

  try {
    if (!isGroup) {
      const otherId = ids.find((id) => id !== Number(creatorId));
      const firstId = Math.min(Number(creatorId), otherId);
      const secondId = Math.max(Number(creatorId), otherId);

      await pool.query(
        "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
        [firstId, secondId],
      );

      const existing = await pool.query(
        `
          SELECT c.id
          FROM conversations c
          JOIN conversation_members first_member
            ON first_member.conversation_id = c.id
           AND first_member.user_id = $1
          JOIN conversation_members second_member
            ON second_member.conversation_id = c.id
           AND second_member.user_id = $2
          WHERE c.is_group = false
            AND c.is_general = false
            AND (
              SELECT COUNT(*)
              FROM conversation_members member_count
              WHERE member_count.conversation_id = c.id
            ) = 2
          LIMIT 1
        `,
        [firstId, secondId],
      );

      if (existing.rowCount > 0) {
        await pool.query("COMMIT");
        return {
          conversation: await getConversation(pool, existing.rows[0].id),
          memberIds: ids,
          created: false,
        };
      }
    }

    const conversation = await pool.query(
      `
        INSERT INTO conversations (name, is_group, is_general, created_by)
        VALUES ($1, $2, false, $3)
        RETURNING id, name, is_group, is_general, created_by, created_at
      `,
      [groupName, isGroup, creatorId],
    );

    const conversationId = conversation.rows[0].id;

    await pool.query(
      `
        INSERT INTO conversation_members (conversation_id, user_id)
        SELECT $1, UNNEST($2::integer[])
      `,
      [conversationId, ids],
    );

    await pool.query("COMMIT");
    return {
      conversation: conversation.rows[0],
      memberIds: ids,
      created: true,
    };
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function leaveConversation(pool, conversationId, userId) {
  const conversation = await getConversation(pool, conversationId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  if (conversation.is_general) {
    throw new Error("You cannot leave General.");
  }

  const result = await pool.query(
    `
      DELETE FROM conversation_members
      WHERE conversation_id = $1
        AND user_id = $2
      RETURNING conversation_id
    `,
    [conversationId, userId],
  );

  if (result.rowCount === 0) {
    throw new Error("You are not a member of that conversation.");
  }
}

module.exports = {
  normalizeConversationId,
  getConversation,
  isConversationMember,
  requireConversationMember,
  getUserConversations,
  getConversationMessages,
  getConversationMessageCount,
  getNamedUsers,
  createConversation,
  leaveConversation,
};
