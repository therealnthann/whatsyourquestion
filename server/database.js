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
      deleted_at TIMESTAMPTZ
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

  // Older databases may have a conversation_id column from a multi-chat
  // schema. This app has one shared chat and does not assign conversation IDs.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'messages'
          AND column_name = 'conversation_id'
      ) THEN
        ALTER TABLE messages
        ALTER COLUMN conversation_id DROP NOT NULL;
      END IF;
    END $$;
  `);

  console.log("Database initialized.");
}

module.exports = {
  pool,
  initializeDatabase,
};