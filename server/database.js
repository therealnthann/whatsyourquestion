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
      content TEXT NOT NULL,
      reply_to_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      conversation_id BIGINT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100),
      is_group BOOLEAN NOT NULL DEFAULT true,
      is_general BOOLEAN NOT NULL DEFAULT false,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
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
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
      ON users (LOWER(username));
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'messages'
          AND column_name = 'deleted_at'
      ) THEN
        ALTER TABLE messages
        ADD COLUMN deleted_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS is_general BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS conversation_id BIGINT;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
      ON messages(conversation_id);

    CREATE UNIQUE INDEX IF NOT EXISTS conversations_general_idx
      ON conversations(is_general)
      WHERE is_general = true;
  `);

  await pool.query("BEGIN");

  try {
    const generalResult = await pool.query(
      `
        INSERT INTO conversations (name, is_group, is_general)
        VALUES ('General', true, true)
        ON CONFLICT (is_general) WHERE is_general = true
        DO UPDATE SET name = 'General'
        RETURNING id
      `,
    );

    const generalId = generalResult.rows[0].id;

    await pool.query(
      `
        INSERT INTO conversation_members (conversation_id, user_id)
        SELECT $1, id
        FROM users
        ON CONFLICT DO NOTHING
      `,
      [generalId],
    );

    await pool.query(
      `
        UPDATE messages
        SET conversation_id = $1
        WHERE conversation_id IS NULL
      `,
      [generalId],
    );

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'messages_conversation_id_fkey'
          AND conrelid = 'messages'::regclass
      ) THEN
        ALTER TABLE messages
        ADD CONSTRAINT messages_conversation_id_fkey
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'messages'
          AND column_name = 'conversation_id'
          AND is_nullable = 'YES'
      ) THEN
        ALTER TABLE messages
        ALTER COLUMN conversation_id SET NOT NULL;
      END IF;
    END $$;
  `);

  console.log("Database initialized.");
}

module.exports = {
  pool,
  initializeDatabase,
};