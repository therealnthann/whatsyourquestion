const upgrades = [
  { id: "curious-users", tier: "Human Internet", name: "Curious Users", baseCost: 10, power: 1 },
  { id: "question-boards", tier: "Human Internet", name: "Question Boards", baseCost: 60, power: 1 },
  { id: "faq-pages", tier: "Human Internet", name: "FAQ Pages", baseCost: 300, power: 4 },
  { id: "online-forums", tier: "Human Internet", name: "Online Forums", baseCost: 1400, power: 15 },
  { id: "search-bars", tier: "Human Internet", name: "Search Bars", baseCost: 6000, power: 55 },
  { id: "comment-sections", tier: "Human Internet", name: "Comment Sections", baseCost: 24000, power: 190 },
  { id: "chat-rooms", tier: "Human Internet", name: "Chat Rooms", baseCost: 90000, power: 650 },
  { id: "blogs", tier: "Human Internet", name: "Blogs", baseCost: 320000, power: 2200 },
  { id: "search-engines", tier: "Growing Internet", name: "Search Engines", baseCost: 1100000, power: 7200 },
  { id: "research-teams", tier: "Growing Internet", name: "Research Teams", baseCost: 3600000, power: 23000 },
  { id: "knowledge-bases", tier: "Growing Internet", name: "Knowledge Bases", baseCost: 11000000, power: 72000 },
  { id: "moderation-teams", tier: "Growing Internet", name: "Moderation Teams", baseCost: 33000000, power: 220000 },
  { id: "web-crawlers", tier: "Growing Internet", name: "Web Crawlers", baseCost: 95000000, power: 650000 },
  { id: "data-centers", tier: "Growing Internet", name: "Data Centers", baseCost: 270000000, power: 1900000 },
  { id: "question-archives", tier: "Growing Internet", name: "Question Archives", baseCost: 760000000, power: 5500000 },
  { id: "recommendation-algorithms", tier: "Growing Internet", name: "Recommendation Algorithms", baseCost: 2100000000, power: 16000000 },
  { id: "ai-assistants", tier: "Intelligent Internet", name: "AI Assistants", baseCost: 5800000000, power: 47000000 },
  { id: "ai-question-generators", tier: "Intelligent Internet", name: "AI Question Generators", baseCost: 16000000000, power: 140000000 },
  { id: "neural-networks", tier: "Intelligent Internet", name: "Neural Networks", baseCost: 44000000000, power: 420000000 },
  { id: "automated-researchers", tier: "Intelligent Internet", name: "Automated Researchers", baseCost: 120000000000, power: 1200000000 },
  { id: "knowledge-graphs", tier: "Intelligent Internet", name: "Knowledge Graphs", baseCost: 330000000000, power: 3400000000 },
  { id: "language-models", tier: "Intelligent Internet", name: "Language Models", baseCost: 900000000000, power: 9500000000 },
  { id: "global-search-networks", tier: "Intelligent Internet", name: "Global Search Networks", baseCost: 2400000000000, power: 26000000000 },
  { id: "predictive-algorithms", tier: "Intelligent Internet", name: "Predictive Algorithms", baseCost: 6500000000000, power: 72000000000 },
  { id: "quantum-computers", tier: "Ridiculous Internet", name: "Quantum Computers", baseCost: 17000000000000, power: 200000000000 },
  { id: "planetary-data-centers", tier: "Ridiculous Internet", name: "Planetary Data Centers", baseCost: 45000000000000, power: 560000000000 },
  { id: "autonomous-researchers", tier: "Ridiculous Internet", name: "Autonomous Researchers", baseCost: 120000000000000, power: 1500000000000 },
  { id: "universal-archives", tier: "Ridiculous Internet", name: "Universal Archives", baseCost: 310000000000000, power: 4000000000000 },
  { id: "global-knowledge-engines", tier: "Ridiculous Internet", name: "Global Knowledge Engines", baseCost: 800000000000000, power: 11000000000000 },
  { id: "quantum-search-engines", tier: "Ridiculous Internet", name: "Quantum Search Engines", baseCost: 2000000000000000, power: 30000000000000 },
  { id: "infinite-data-storage", tier: "Ridiculous Internet", name: "Infinite Data Storage", baseCost: 5100000000000000, power: 80000000000000 },
  { id: "internet-replication-systems", tier: "Ridiculous Internet", name: "Internet Replication Systems", baseCost: 13000000000000000, power: 210000000000000 },
  { id: "question-factories", tier: "Endgame", name: "Question Factories", baseCost: 33000000000000000, power: 550000000000000 },
  { id: "question-megastructures", tier: "Endgame", name: "Question Megastructures", baseCost: 83000000000000000, power: 1400000000000000 },
  { id: "universal-question-networks", tier: "Endgame", name: "Universal Question Networks", baseCost: 210000000000000000, power: 3500000000000000 },
  { id: "reality-simulation-servers", tier: "Endgame", name: "Reality Simulation Servers", baseCost: 530000000000000000, power: 8800000000000000 },
  { id: "the-infinite-internet", tier: "Endgame", name: "The Infinite Internet", baseCost: 1300000000000000000, power: 22000000000000000 },
  { id: "the-question-engine", tier: "Endgame", name: "The Question Engine", baseCost: 3300000000000000000, power: 55000000000000000 },
  { id: "the-internet-question", tier: "Endgame", name: "The Internet Question", baseCost: 8300000000000000000, power: 140000000000000000 },
  { id: "clicker-training", tier: "Human Internet", name: "Clicker Training", baseCost: 15, clickPower: 1 },
  { id: "faster-fingers", tier: "Human Internet", name: "Faster Fingers", baseCost: 100, clickPower: 3 },
  { id: "power-clicking", tier: "Growing Internet", name: "Power Clicking", baseCost: 500000, clickPower: 100 },
  { id: "mega-click", tier: "Growing Internet", name: "Mega Click", baseCost: 50000000, clickPower: 5000 },
  { id: "click-masters", tier: "Intelligent Internet", name: "Click Masters", baseCost: 10000000000, clickPower: 500000 },
  { id: "automated-clicking", tier: "Intelligent Internet", name: "Automated Clicking", baseCost: 1000000000000, clickPower: 100000000 },
  { id: "quantum-click", tier: "Ridiculous Internet", name: "Quantum Click", baseCost: 100000000000000, clickPower: 50000000000 },
  { id: "click-singularity", tier: "Endgame", name: "Click Singularity", baseCost: 100000000000000000, clickPower: 100000000000000 },
];

const upgradeById = new Map(upgrades.map((upgrade) => [upgrade.id, upgrade]));
const COST_GROWTH = 1.15;

function costFor(upgrade, owned) {
  return Math.max(1, Math.floor(upgrade.baseCost * Math.pow(COST_GROWTH, owned)));
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function publicState(row) {
  const elapsed = Math.max(0, (Date.now() - new Date(row.updated_at).getTime()) / 1000);
  return {
    questions: String(Math.floor(Number(row.questions) + Number(row.questions_per_second) * elapsed)),
    questionsPerSecond: String(row.questions_per_second),
    clickPower: String(row.click_power),
    upgrades: row.upgrades || {},
    updatedAt: new Date().toISOString(),
  };
}

async function mutateGame(pool, mutation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM internet_questions WHERE id = 1 FOR UPDATE");
    const row = result.rows[0];
    const elapsed = Math.max(0, (Date.now() - new Date(row.updated_at).getTime()) / 1000);
    let questions = Number(row.questions) + Number(row.questions_per_second) * elapsed;
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
    let newPps = pps;
    let newClickPower = clickPower;
    if (upgrade.power) newPps += upgrade.power;
    if (upgrade.clickPower) newClickPower += upgrade.clickPower;
    return { questions: questions - cost, pps: newPps, clickPower: newClickPower, owned, result: { upgradeId, cost } };
  });
}

module.exports = { upgrades, getGameState, clickGame, buyUpgrade };
