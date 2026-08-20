const crypto = require("crypto");
const readline = require("readline");
const argon2 = require("argon2");
const { initializeDatabase, pool } = require("./database");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  if (rl.closed) {
    return Promise.resolve("e");
  }

  return new Promise((resolve) => {
    try {
      rl.question(question, resolve);
    } catch (error) {
      if (error.code === "ERR_USE_AFTER_CLOSE") {
        resolve("e");
        return;
      }

      throw error;
    }
  });
}

async function getUsers() {
  const result = await pool.query(
    `
      SELECT id, username, created_at
      FROM users
      ORDER BY LOWER(username) NULLS LAST, id
    `,
  );

  return result.rows;
}

function displayName(user) {
  return user.username || "Unnamed user";
}

async function confirm(question) {
  const answer = (await ask(`${question} Type yes to confirm: `))
    .trim()
    .toLowerCase();

  return answer === "yes";
}

async function resetAccessCode(user) {
  const confirmed = await confirm(
    `Reset the access code for ${displayName(user)}?`,
  );

  if (!confirmed) {
    console.log("Reset cancelled.");
    return;
  }

  const accessCode = crypto.randomBytes(18).toString("base64url");
  const accessCodeHash = await argon2.hash(accessCode);

  await pool.query("BEGIN");

  try {
    const result = await pool.query(
      `
        UPDATE users
        SET access_code_hash = $1
        WHERE id = $2
        RETURNING id
      `,
      [accessCodeHash, user.id],
    );

    if (result.rowCount === 0) {
      throw new Error("User no longer exists.");
    }

    await pool.query(
      `
        DELETE FROM sessions
        WHERE sess->>'userId' = $1
      `,
      [String(user.id)],
    );

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  console.log("\nAccess code reset successfully.");
  console.log("Give this code to the user now. It will not be shown again:");
  console.log(accessCode);
}

async function deleteAccount(user) {
  const confirmed = await confirm(
    `Permanently delete ${displayName(user)} and their account data?`,
  );

  if (!confirmed) {
    console.log("Delete cancelled.");
    return;
  }

  await pool.query("BEGIN");

  try {
    await pool.query(
      `
        DELETE FROM sessions
        WHERE sess->>'userId' = $1
      `,
      [String(user.id)],
    );

    const result = await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
        RETURNING id
      `,
      [user.id],
    );

    if (result.rowCount === 0) {
      throw new Error("User no longer exists.");
    }

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  console.log(`Deleted ${displayName(user)}.`);
  console.log("Their messages and memberships were removed by the database relationships.");
  console.log("Conversations were preserved.");
}

async function userActions(user) {
  while (true) {
    console.log(`\nUser Management > ${displayName(user)}\n`);
    console.log("1. Reset access code");
    console.log("2. Delete account");
    console.log("3. Back");

    const choice = (await ask("Select an action: ")).trim();

    try {
      if (choice === "1") {
        await resetAccessCode(user);
      } else if (choice === "2") {
        await deleteAccount(user);
        return;
      } else if (choice === "3") {
        return;
      } else {
        console.log("Please choose 1, 2, or 3.");
      }
    } catch (error) {
      console.error("\nAction failed:", error.message);
    }
  }
}

async function menu() {
  while (true) {
    const users = await getUsers();

    console.log("\nUser Management\n");

    if (users.length === 0) {
      console.log("No users exist.");
    } else {
      users.forEach((user, index) => {
        console.log(`${index + 1}. ${displayName(user)}`);
      });
    }

    console.log("\nE. Exit");

    const choice = (await ask("Select a user: ")).trim().toLowerCase();

    if (choice === "e" || choice === "exit") {
      return;
    }

    const userIndex = Number(choice) - 1;

    if (!Number.isInteger(userIndex) || !users[userIndex]) {
      console.log("Please select a listed user or E to exit.");
      continue;
    }

    await userActions(users[userIndex]);
  }
}

async function main() {
  try {
    await initializeDatabase();
    await menu();
  } catch (error) {
    console.error("\nUser management failed:", error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
}

main();
