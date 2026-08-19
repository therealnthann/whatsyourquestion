const { initializeDatabase, pool } = require("./database");

const count = Number(process.argv[2] || 160);

async function seedMessages() {
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new Error("Count must be an integer between 1 and 10000.");
  }

  await initializeDatabase();

  const users = await pool.query(
    `
      SELECT id, username
      FROM users
      WHERE username IS NOT NULL
      ORDER BY id
    `,
  );

  if (users.rowCount === 0) {
    throw new Error("Create at least one named user before seeding messages.");
  }

  await pool.query("BEGIN");

  try {
    for (let index = 0; index < count; index++) {
      const user = users.rows[index % users.rowCount];
      const createdAt = new Date(Date.now() - index * 60 * 60 * 1000);

      await pool.query(
        `
          INSERT INTO messages (user_id, content, created_at)
          VALUES ($1, $2, $3)
        `,
        [
          user.id,
          `Seed message ${index + 1}: searchable test content`,
          createdAt,
        ],
      );
    }

    await pool.query("COMMIT");
    console.log(`Inserted ${count} test messages.`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

seedMessages()
  .catch((error) => {
    console.error("Message seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
