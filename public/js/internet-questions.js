const internetQuestionsScreen = document.getElementById("internet-questions-screen");
const internetQuestionsBack = document.getElementById("internet-questions-back");
const internetQuestionsOpen = document.getElementById("internet-questions-easter-egg");
const askQuestionButton = document.getElementById("ask-question-button");
const questionsTotal = document.getElementById("internet-questions-total");
const questionsRate = document.getElementById("internet-questions-rate");
const upgradeList = document.getElementById("internet-questions-upgrade-list");
const gameStatus = document.getElementById("internet-questions-status");
const floatContainer = document.getElementById("internet-questions-floats");

let internetQuestionsState = null;
let internetQuestionsUpgrades = [];
let gameSocket = null;
let gameAnimationFrame = null;

function formatQuestions(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "a lot";
  if (number < 1000) return Math.floor(number).toLocaleString();
  const units = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
  let scaled = number;
  let unit = "";
  for (const currentUnit of units) {
    if (scaled < 1000) break;
    scaled /= 1000;
    unit = currentUnit;
  }
  return `${scaled >= 100 ? Math.floor(scaled) : scaled.toFixed(scaled >= 10 ? 1 : 2)}${unit}`;
}

function upgradeCost(upgrade, count) {
  return Math.floor(upgrade.baseCost * Math.pow(1.15, count));
}

function renderTotals() {
  if (!internetQuestionsState) return;
  const elapsed = internetQuestionsState.active
    ? Math.max(0, (Date.now() - new Date(internetQuestionsState.updatedAt).getTime()) / 1000)
    : 0;
  const total = Number(internetQuestionsState.questions) + Number(internetQuestionsState.questionsPerSecond) * elapsed;
  questionsTotal.textContent = formatQuestions(total);
  questionsRate.textContent = `${formatQuestions(internetQuestionsState.questionsPerSecond)} / sec`;
}

function renderUpgrades() {
  const groups = new Map();
  internetQuestionsUpgrades.forEach((upgrade) => {
    if (!groups.has(upgrade.tier)) groups.set(upgrade.tier, []);
    groups.get(upgrade.tier).push(upgrade);
  });
  upgradeList.replaceChildren();
  for (const [tier, upgrades] of groups) {
    const tierElement = document.createElement("section");
    tierElement.className = "internet-questions-tier";
    tierElement.innerHTML = `<h3>${tier}</h3><div class="internet-questions-upgrade-grid"></div>`;
    const grid = tierElement.querySelector("div");
    upgrades.forEach((upgrade) => {
      const count = Number(internetQuestionsState?.upgrades?.[upgrade.id] || 0);
      const cost = upgradeCost(upgrade, count);
      const button = document.createElement("button");
      button.className = "internet-questions-upgrade";
      button.type = "button";
      button.dataset.upgradeId = upgrade.id;
      button.disabled = Number(internetQuestionsState?.questions || 0) < cost;
      const effect = upgrade.type === "click"
        ? `+${formatQuestions(upgrade.clickPower)} per click`
        : `+${formatQuestions(upgrade.power)} questions / sec`;
      button.innerHTML = `<span class="internet-questions-upgrade-copy"><strong>${upgrade.name}</strong><small>${effect}</small></span><span class="internet-questions-upgrade-cost">${formatQuestions(cost)} <small>${count ? `x${count}` : ""}</small></span>`;
      grid.append(button);
    });
    upgradeList.append(tierElement);
  }
}

function renderGame() {
  renderTotals();
  renderUpgrades();
}

function showGameStatus(message) {
  gameStatus.textContent = message;
  window.setTimeout(() => {
    if (gameStatus.textContent === message) gameStatus.textContent = "";
  }, 2200);
}

function bindGameSocket() {
  if (gameSocket || typeof socket === "undefined" || !socket) return;
  gameSocket = socket;
  gameSocket.on("internet-questions:state", (state) => {
    internetQuestionsState = state;
    renderGame();
  });
  gameSocket.on("connect", () => {
    if (!internetQuestionsScreen.classList.contains("hidden")) {
      gameSocket.emit("internet-questions:enter");
    }
  });
}

async function openInternetQuestions() {
  document.getElementById("settings-overlay").classList.add("hidden");
  document.getElementById("chat-screen").classList.add("hidden");
  internetQuestionsScreen.classList.remove("hidden");
  bindGameSocket();
  gameSocket?.emit("internet-questions:enter");
  try {
    const response = await fetch("/api/internet-questions");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the game.");
    internetQuestionsState = data.state;
    internetQuestionsUpgrades = data.upgrades;
    renderGame();
  } catch (error) {
    showGameStatus(error.message);
  }
}

function closeInternetQuestions() {
  gameSocket?.emit("internet-questions:leave");
  internetQuestionsScreen.classList.add("hidden");
  document.getElementById("chat-screen").classList.remove("hidden");
  if (gameAnimationFrame) cancelAnimationFrame(gameAnimationFrame);
}

function showFloatingQuestion() {
  const float = document.createElement("span");
  float.className = "question-float";
  float.textContent = `+${formatQuestions(internetQuestionsState?.clickPower || 1)}`;
  float.style.left = `${45 + Math.random() * 10}%`;
  floatContainer.append(float);
  float.addEventListener("animationend", () => float.remove());
}

async function askQuestion() {
  askQuestionButton.disabled = true;
  showFloatingQuestion();
  try {
    const response = await fetch("/api/internet-questions/click", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not ask a question.");
    internetQuestionsState = data.state;
    renderGame();
  } catch (error) {
    showGameStatus(error.message);
  } finally {
    askQuestionButton.disabled = false;
  }
}

upgradeList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-upgrade-id]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/internet-questions/upgrades/${button.dataset.upgradeId}`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not buy that upgrade.");
    internetQuestionsState = data.state;
    renderGame();
  } catch (error) {
    showGameStatus(error.message);
    renderGame();
  }
});

internetQuestionsOpen.addEventListener("click", openInternetQuestions);
internetQuestionsBack.addEventListener("click", closeInternetQuestions);
askQuestionButton.addEventListener("click", askQuestion);

function animateGameTotals() {
  if (!internetQuestionsScreen.classList.contains("hidden")) renderTotals();
  gameAnimationFrame = requestAnimationFrame(animateGameTotals);
}
animateGameTotals();
