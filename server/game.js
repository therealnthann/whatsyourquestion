const upgrades = [
  { id: "curious-users", tier: "Human Internet", name: "Curious Users", baseCost: 10, type: "production", power: 1 },
  { id: "question-boards", tier: "Human Internet", name: "Question Boards", baseCost: 60, type: "click", clickPower: 2 },
  { id: "faq-pages", tier: "Human Internet", name: "FAQ Pages", baseCost: 300, type: "production", power: 3 },
  { id: "online-forums", tier: "Human Internet", name: "Online Forums", baseCost: 1400, type: "click", clickPower: 5 },
  { id: "search-bars", tier: "Human Internet", name: "Search Bars", baseCost: 6000, type: "production", power: 8 },
  { id: "comment-sections", tier: "Human Internet", name: "Comment Sections", baseCost: 24000, type: "click", clickPower: 9 },
  { id: "chat-rooms", tier: "Human Internet", name: "Chat Rooms", baseCost: 90000, type: "production", power: 20 },
  { id: "blogs", tier: "Human Internet", name: "Blogs", baseCost: 320000, type: "click", clickPower: 14 },
  { id: "search-engines", tier: "Growing Internet", name: "Search Engines", baseCost: 1100000, type: "production", power: 50 },
  { id: "research-teams", tier: "Growing Internet", name: "Research Teams", baseCost: 3600000, type: "click", clickPower: 22 },
  { id: "knowledge-bases", tier: "Growing Internet", name: "Knowledge Bases", baseCost: 11000000, type: "production", power: 120 },
  { id: "moderation-teams", tier: "Growing Internet", name: "Moderation Teams", baseCost: 33000000, type: "click", clickPower: 36 },
  { id: "web-crawlers", tier: "Growing Internet", name: "Web Crawlers", baseCost: 95000000, type: "production", power: 300 },
  { id: "data-centers", tier: "Growing Internet", name: "Data Centers", baseCost: 270000000, type: "click", clickPower: 61 },
  { id: "question-archives", tier: "Growing Internet", name: "Question Archives", baseCost: 760000000, type: "production", power: 750 },
  { id: "recommendation-algorithms", tier: "Growing Internet", name: "Recommendation Algorithms", baseCost: 2100000000, type: "click", clickPower: 101 },
  { id: "ai-assistants", tier: "Intelligent Internet", name: "AI Assistants", baseCost: 5800000000, type: "production", power: 1800 },
  { id: "ai-question-generators", tier: "Intelligent Internet", name: "AI Question Generators", baseCost: 16000000000, type: "click", clickPower: 161 },
  { id: "neural-networks", tier: "Intelligent Internet", name: "Neural Networks", baseCost: 44000000000, type: "production", power: 4200 },
  { id: "automated-researchers", tier: "Intelligent Internet", name: "Automated Researchers", baseCost: 120000000000, type: "click", clickPower: 251 },
  { id: "knowledge-graphs", tier: "Intelligent Internet", name: "Knowledge Graphs", baseCost: 330000000000, type: "production", power: 10000 },
  { id: "language-models", tier: "Intelligent Internet", name: "Language Models", baseCost: 900000000000, type: "click", clickPower: 401 },
  { id: "global-search-networks", tier: "Intelligent Internet", name: "Global Search Networks", baseCost: 2400000000000, type: "production", power: 24000 },
  { id: "predictive-algorithms", tier: "Intelligent Internet", name: "Predictive Algorithms", baseCost: 6500000000000, type: "click", clickPower: 651 },
  { id: "quantum-computers", tier: "Ridiculous Internet", name: "Quantum Computers", baseCost: 17000000000000, type: "production", power: 60000 },
  { id: "planetary-data-centers", tier: "Ridiculous Internet", name: "Planetary Data Centers", baseCost: 45000000000000, type: "click", clickPower: 1001 },
  { id: "autonomous-researchers", tier: "Ridiculous Internet", name: "Autonomous Researchers", baseCost: 120000000000000, type: "production", power: 150000 },
  { id: "universal-archives", tier: "Ridiculous Internet", name: "Universal Archives", baseCost: 310000000000000, type: "click", clickPower: 1501 },
  { id: "global-knowledge-engines", tier: "Ridiculous Internet", name: "Global Knowledge Engines", baseCost: 800000000000000, type: "production", power: 360000 },
  { id: "quantum-search-engines", tier: "Ridiculous Internet", name: "Quantum Search Engines", baseCost: 2000000000000000, type: "click", clickPower: 2201 },
  { id: "infinite-data-storage", tier: "Ridiculous Internet", name: "Infinite Data Storage", baseCost: 5100000000000000, type: "production", power: 850000 },
  { id: "internet-replication-systems", tier: "Ridiculous Internet", name: "Internet Replication Systems", baseCost: 13000000000000000, type: "click", clickPower: 3201 },
  { id: "question-factories", tier: "Endgame", name: "Question Factories", baseCost: 33000000000000000, type: "production", power: 2000000 },
  { id: "question-megastructures", tier: "Endgame", name: "Question Megastructures", baseCost: 83000000000000000, type: "click", clickPower: 4601 },
  { id: "universal-question-networks", tier: "Endgame", name: "Universal Question Networks", baseCost: 210000000000000000, type: "production", power: 4800000 },
  { id: "reality-simulation-servers", tier: "Endgame", name: "Reality Simulation Servers", baseCost: 530000000000000000, type: "click", clickPower: 6501 },
  { id: "the-infinite-internet", tier: "Endgame", name: "The Infinite Internet", baseCost: 1300000000000000000, type: "production", power: 11000000 },
  { id: "the-question-engine", tier: "Endgame", name: "The Question Engine", baseCost: 3300000000000000000, type: "click", clickPower: 9001 },
  { id: "the-internet-question", tier: "Endgame", name: "The Internet Question", baseCost: 8300000000000000000, type: "production", power: 25000000 },
];

const upgradeById = new Map(upgrades.map((upgrade) => [upgrade.id, upgrade]));
const COST_GROWTH = 1.15;
const activeGameSockets = new Set();

function costFor(upgrade, owned) {
  return Math.max(1, Math.floor(upgrade.baseCost * Math.pow(COST_GROWTH, owned)));
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function accruedQuestions(row) {
  if (activeGameSockets.size === 0) {
    return Number(row.questions);
  }

  const elapsed = Math.max(0, (Date.now() - new Date(row.updated_at).getTime()) / 1000);
  return Number(row.questions) + Number(row.questions_per_second) * elapsed;
}

function publicState(row) {
  return {
    questions: String(Math.floor(accruedQuestions(row))),
    questionsPerSecond: String(row.questions_per_second),
    clickPower: String(row.click_power),
    upgrades: row.upgrades || {},
    active: activeGameSockets.size > 0,
    updatedAt: new Date().toISOString(),
  };
}

async function mutateGame(pool, mutation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM internet_questions WHERE id = 1 FOR UPDATE");
    const row = result.rows[0];
    let questions = accruedQuestions(row);
    let pps = Number(row.questions_per_second);
    let clickPower = Number(row.click_power);
    const owned = { ...(row.upgrades || {}) };
    const outcome = await mutation({ questions, pps, clickPower, owned });
    questions = finiteNumber(outcome.questions);
    const updated = await client.query(
      `UPDATE internet_questions SET questions = $1, questions_per_second = $2, click_power = $3, upgrades = $4, updated_at = NOW() WHERE id = 1 RETURNING *`,
      [Math.floor(questions), finiteNumber(outcome.pps), finiteNumber(outcome.clickPower), JSON.stringify(owned)],
    );
    await client.query("COMMIT");
    return { state: publicState(updated.rows[0]), outcome: outcome.result || null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getGameState(pool) {
  const result = await pool.query("SELECT * FROM internet_questions WHERE id = 1");
  return publicState(result.rows[0]);
}

async function setGamePresence(pool, socketId, present) {
  if (present) {
    if (activeGameSockets.size === 0) {
      await mutateGame(pool, ({ questions, pps, clickPower, owned }) => ({
        questions,
        pps,
        clickPower,
        owned,
      }));
    }
    activeGameSockets.add(socketId);
    return;
  }

  if (!activeGameSockets.has(socketId)) return;

  if (activeGameSockets.size === 1) {
    await mutateGame(pool, ({ questions, pps, clickPower, owned }) => ({
      questions,
      pps,
      clickPower,
      owned,
    }));
  }

  activeGameSockets.delete(socketId);
}

async function clickGame(pool) {
  return mutateGame(pool, ({ questions, pps, clickPower, owned }) => ({ questions: questions + clickPower, pps, clickPower, owned }));
}

async function buyUpgrade(pool, upgradeId) {
  const upgrade = upgradeById.get(upgradeId);
  if (!upgrade) throw new Error("Unknown upgrade.");
  return mutateGame(pool, ({ questions, pps, clickPower, owned }) => {
    const count = Number(owned[upgrade.id] || 0);
    const cost = costFor(upgrade, count);
    if (questions < cost) throw new Error("Not enough Questions.");
    owned[upgrade.id] = count + 1;
    return {
      questions: questions - cost,
      pps: pps + (upgrade.type === "production" ? upgrade.power : 0),
      clickPower: clickPower + (upgrade.type === "click" ? upgrade.clickPower : 0),
      owned,
      result: { upgradeId, cost },
    };
  });
}

module.exports = { upgrades, getGameState, clickGame, buyUpgrade, setGamePresence };
