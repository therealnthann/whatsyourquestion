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

    console.log("\nWhat's Your Question - Add Users\n");
    console.log("Access codes must be at least 8 characters.\n");

    let createdCount = 0;
    const accessCodes = new Set();

    while (true) {
      const accessCode = await ask(
        `Access code #${createdCount + 1} (leave blank to finish): `
      );

      if (!accessCode) {
        break;
      }

      if (accessCode.length < 8) {
        throw new Error("Access codes must be at least 8 characters.");
      }

      if (accessCodes.has(accessCode)) {
        throw new Error("Each access code must be different.");
      }

      await createAccessCode(accessCode);
      accessCodes.add(accessCode);
      createdCount += 1;
      console.log("Access code created.");
    }

    console.log(`\nCreated ${createdCount} access code(s).`);
    console.log(
      "The usernames will be chosen the first time each code is used."
    );
  } catch (error) {
    console.error("\nSetup failed:", error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
}

setup();