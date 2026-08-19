const argon2 = require("argon2");
const { pool } = require("./database");

/**
 * Create an account from an access code.
 *
 * The username starts as NULL.
 * The first login will assign the username.
 */
async function createAccessCode(accessCode) {
  if (!accessCode || accessCode.length < 8) {
    throw new Error("Access code must be at least 8 characters.");
  }

  const hash = await argon2.hash(accessCode);

  const result = await pool.query(
    `
      INSERT INTO users (access_code_hash)
      VALUES ($1)
      RETURNING id, username, created_at
    `,
    [hash]
  );

  return result.rows[0];
}

/**
 * Find the account belonging to an access code.
 *
 * Because access codes are hashed, we cannot search PostgreSQL
 * for the code directly. We retrieve the small set of users
 * and verify the hash with Argon2.
 */
async function authenticateWithCode(accessCode) {
  if (!accessCode) {
    return null;
  }

  const result = await pool.query(`
    SELECT id, username, access_code_hash
    FROM users
  `);

  for (const user of result.rows) {
    const valid = await argon2.verify(
      user.access_code_hash,
      accessCode
    );

    if (valid) {
      return {
        id: user.id,
        username: user.username,
        needsUsername: user.username === null,
      };
    }
  }

  return null;
}

/**
 * Assign a username to an account during first login.
 */
async function setUsername(userId, username) {
  const normalizedUsername = username.trim().normalize("NFC");

  if (
    normalizedUsername.length < 1 ||
    normalizedUsername.length > 32 ||
    /[\u0000-\u001F\u007F]/.test(normalizedUsername)
  ) {
    throw new Error(
      "Username must be between 1 and 32 characters and contain no control characters.",
    );
  }

  const existing = await pool.query(
    `
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER($1)
        AND id != $2
    `,
    [normalizedUsername, userId]
  );

  if (existing.rows.length > 0) {
    throw new Error("That username is already taken.");
  }

  const result = await pool.query(
    `
      UPDATE users
      SET username = $1
      WHERE id = $2
      RETURNING id, username
    `,
    [normalizedUsername, userId]
  );

  if (result.rows.length === 0) {
    throw new Error("User not found.");
  }

  return result.rows[0];
}

/**
 * Change an existing access code.
 */
async function changeAccessCode(userId, newAccessCode) {
  if (!newAccessCode || newAccessCode.length < 8) {
    throw new Error("Access code must be at least 8 characters.");
  }

  const hash = await argon2.hash(newAccessCode);

  await pool.query(
    `
      UPDATE users
      SET access_code_hash = $1
      WHERE id = $2
    `,
    [hash, userId]
  );
}

/**
 * Verify that an access code belongs to a user.
 */
async function verifyUserAccessCode(userId, accessCode) {
  if (!accessCode) {
    return false;
  }

  const result = await pool.query(
    `
      SELECT access_code_hash
      FROM users
      WHERE id = $1
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  return argon2.verify(
    result.rows[0].access_code_hash,
    accessCode
  );
}

module.exports = {
  createAccessCode,
  authenticateWithCode,
  setUsername,
  changeAccessCode,
  verifyUserAccessCode,
};