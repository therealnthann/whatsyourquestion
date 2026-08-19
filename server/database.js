const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(32) UNIQUE,
      access_code_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id BIGINT,
      content TEXT NOT NULL,
      reply_to_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction VARCHAR(32) NOT NULL,
      UNIQUE(message_id, user_id, reaction)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS messages_created_at_idx
      ON messages(created_at);

    CREATE INDEX IF NOT EXISTS messages_user_id_idx
      ON messages(user_id);

    CREATE INDEX IF NOT EXISTS reactions_message_id_idx
      ON reactions(message_id);

    CREATE INDEX IF NOT EXISTS sessions_expire_idx
      ON sessions(expire);
  `);

  // Existing database migration:
  // usernames were originally required, but first-time
  // access codes now need to be able to have no username yet.
  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN username DROP NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS conversation_id BIGINT;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_conversation_created_at_idx
      ON messages(conversation_id, created_at);
  `);

  await pool.query("BEGIN");

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(100),
        is_group BOOLEAN NOT NULL DEFAULT true,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS conversation_reads (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        last_read_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
        PRIMARY KEY (user_id, conversation_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS conversations_general_unique_idx
        ON conversations (name)
        WHERE name = 'General' AND is_group = false;

      CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx
        ON conversation_members(user_id);

      CREATE INDEX IF NOT EXISTS conversation_members_conversation_id_idx
        ON conversation_members(conversation_id);

      CREATE INDEX IF NOT EXISTS conversation_reads_conversation_id_idx
        ON conversation_reads(conversation_id);
    `);

    const generalResult = await pool.query(`
      SELECT id
      FROM conversations
      WHERE name = 'General' AND is_group = false
      LIMIT 1
    `);

    let generalId;

    if (generalResult.rowCount === 0) {
      const createdGeneral = await pool.query(`
        INSERT INTO conversations (name, is_group)
        VALUES ('General', false)
        RETURNING id
      `);

      generalId = createdGeneral.rows[0].id;
    } else {
      generalId = generalResult.rows[0].id;
    }

    await pool.query(`
      INSERT INTO conversation_members (conversation_id, user_id)
      SELECT $1, id
      FROM users
      ON CONFLICT (conversation_id, user_id) DO NOTHING
    `, [generalId]);

    await pool.query(`
      UPDATE messages
      SET conversation_id = $1
      WHERE conversation_id IS NULL
    `, [generalId]);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'messages_conversation_id_fkey'
        ) THEN
          ALTER TABLE messages
          ADD CONSTRAINT messages_conversation_id_fkey
          FOREIGN KEY (conversation_id)
          REFERENCES conversations(id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await pool.query(`
      ALTER TABLE messages
      ALTER COLUMN conversation_id SET NOT NULL
    `);

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  console.log("Database initialized.");
}

module.exports = {
  pool,
  initializeDatabase,
};