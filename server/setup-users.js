const readline = require("readline");
const { initializeDatabase, pool } = require("./database");
const { createAccessCode } = require("./auth");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function setup() {
  try {
    await initializeDatabase();

    const existingUsers = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users"
    );

    if (existingUsers.rows[0].count > 0) {
      console.log(
        "Users already exist. No new access codes were created."
      );

      rl.close();
      await pool.end();
      return;
    }

    console.log("\nWhat's Your Question - Initial Setup\n");
    console.log("Create the two access codes for your chat.\n");
    console.log("Access codes must be at least 8 characters.\n");

    const code1 = await ask("Access code #1: ");
    const code2 = await ask("Access code #2: ");

    if (code1.length < 8 || code2.length < 8) {
      throw new Error(
        "Both access codes must be at least 8 characters."
      );
    }

    if (code1 === code2) {
      throw new Error(
        "The two access codes must be different."
      );
    }

    await createAccessCode(code1);
    await createAccessCode(code2);

    console.log("\nTwo access codes created successfully.");
    console.log(
      "The usernames will be chosen the first time each code is used."
    );
  } catch (error) {
    console.error("\nSetup failed:", error.message);
  } finally {
    rl.close();
    await pool.end();
  }
}

setup();