// --- Helpers ---
function getCookie(name) {
  return document.cookie.split("; ").reduce((acc, part) => {
    const [k, v] = part.split("=");
    if (k === name) acc = decodeURIComponent(v || "");
    return acc;
  }, "");
}

async function apiLogin(name) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "login failed");
  return res.json();
}

// Deterministic shuffle pieces
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleDeterministic(arr, seedStr) {
  const rnd = mulberry32(hashString(seedStr));
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- DOM refs ---
const loginPanel = document.getElementById("loginPanel");
const loginForm = document.getElementById("loginForm");
const displayNameInput = document.getElementById("displayName");

const mainPanel = document.getElementById("mainPanel");
const whoami = document.getElementById("whoami");
const cardGrid = document.getElementById("card");
const seedDateEl = document.getElementById("seedDate");

const calledList = document.getElementById("calledList");
const availableList = document.getElementById("availableList");
const bingoCallsEl = document.getElementById("bingoCalls");
const playersListEl = document.getElementById("playersList");

const switchUser = document.getElementById("switchUser");
const callBingoBtn = document.getElementById("callBingoBtn");
const autoPlayBtn = document.getElementById("autoPlayBtn");
const clearCardBtn = document.getElementById("clearCardBtn");

// --- App state ---
let socket = null;
let phrases = [];
let called = new Set();
let name = getCookie("displayName") || localStorage.getItem("displayName") || "";
let roundKey = null;
let cardPhrases = [];
let localMarked = new Set(); // your personal marks (per name+date)
let bingoCalls = [];         // [{name, valid, time, lineType, indices}]
let players = [];            // ["Alice", "Bob", ...]
let myWinningIndices = new Set(); // highlight indices after valid call

// Auto play state
function autoPlayKey() { return `bingAutoPlay:${name}|${roundKey}`; }
function autoCalledKey() { return `bingAutoCalled:${name}|${roundKey}`; }
function getAutoPlayEnabled() { return localStorage.getItem(autoPlayKey()) === "1"; }
function setAutoPlayEnabled(v) { localStorage.setItem(autoPlayKey(), v ? "1" : "0"); }
function getAutoCalled() { return localStorage.getItem(autoCalledKey()) === "1"; }
function setAutoCalled(v) { localStorage.setItem(autoCalledKey(), v ? "1" : "0"); }

// Marks storage
function marksKey() { return `bingSelected:${name}|${roundKey}`; }
function loadMarks() {
  try {
    const raw = localStorage.getItem(marksKey());
    localMarked = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    localMarked = new Set();
  }
}
function saveMarks() {
  try { localStorage.setItem(marksKey(), JSON.stringify([...localMarked])); } catch {}
}

// --- UI show/hide ---
function showLogin() {
  loginPanel.classList.remove("hidden");
  mainPanel.classList.add("hidden");
}
function showMain() {
  loginPanel.classList.add("hidden");
  mainPanel.classList.remove("hidden");
  whoami.textContent = name;
  renderAutoPlayButton();
}

// --- Auth flow ---
async function doLogin(n) {
  const clean = String(n || "").trim();
  if (!clean) return;
  await apiLogin(clean);
  localStorage.setItem("displayName", clean);
  name = clean;
  whoami.textContent = name;
  showMain();
  connectSocket();
  initialLoad();
}

// --- Socket + initial load ---
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on("connect_error", (err) => console.error("socket connect_error", err));

  socket.on("connect", () => {
    if (name) socket.emit("player:join", { name });
  });

  socket.on("players:update", ({ players: p }) => {
    players = Array.isArray(p) ? p : [];
    renderPlayers();
  });

  socket.on("phrases:update", ({ phrases: p, called: c, roundKey: rk }) => {
    phrases = p.map((s) => s.normalize("NFC"));
    called = new Set((c || []).map((s) => s.normalize("NFC")));
    if (rk && rk !== roundKey) {
      roundKey = rk;
      loadMarks();
      myWinningIndices = new Set();
      setAutoCalled(false);         // reset per day
    }
    ensureCard();
    if (getAutoPlayEnabled()) {
      autoMarkCalled();
      tryAutoCallBingo();
    }
    renderAll();
  });

  socket.on("bingo:update", ({ calls }) => {
    bingoCalls = (calls || []).slice().sort((a, b) => a.time - b.time);
    const entry = bingoCalls.filter(c => c.name === name && c.valid).pop();
    if (entry && Array.isArray(entry.indices)) {
      myWinningIndices = new Set(entry.indices);
    } else {
      myWinningIndices = new Set();
    }
    renderBingoCalls();
    renderCard();
  });
}

async function initialLoad() {
  const res = await fetch("/api/phrases");
  const data = await res.json();
  phrases = data.phrases.map((s) => s.normalize("NFC"));
  called = new Set((data.called || []).map((s) => s.normalize("NFC")));
  roundKey = data.roundKey;
  loadMarks();
  myWinningIndices = new Set();
  setAutoCalled(false);
  ensureCard();
  if (getAutoPlayEnabled()) {
    autoMarkCalled();
    tryAutoCallBingo();
  }
  renderAll();
}

// --- Card creation ---
function ensureCard() {
  if (!roundKey || phrases.length < 25) {
    cardPhrases = [];
    return;
  }
  const shuffled = shuffleDeterministic(phrases, `${name || "guest"}|${roundKey}`);
  const first25 = shuffled.slice(0, 25).map(s => s.normalize("NFC"));
  first25[12] = "FREE";
  cardPhrases = first25;
}

// --- Local bingo validation ---
const LINES = (() => {
  const rows = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => r * 5 + c));
  const cols = Array.from({ length: 5 }, (_, c) => Array.from({ length: 5 }, (_, r) => r * 5 + c));
  const diag1 = [0, 6, 12, 18, 24];
  const diag2 = [4, 8, 12, 16, 20];
  return [...rows, ...cols, diag1, diag2];
})();
function hasBingoLocally() {
  if (cardPhrases.length !== 25) return { ok: false, line: [] };
  for (const line of LINES) {
    let ok = true;
    for (const idx of line) {
      const phr = cardPhrases[idx];
      if (phr !== "FREE" && !called.has(phr)) { ok = false; break; }
    }
    if (ok) return { ok: true, line };
  }
  return { ok: false, line: [] };
}

// --- Auto play helpers ---
function autoMarkCalled() {
  if (cardPhrases.length !== 25) return;
  let changed = false;
  for (const phr of cardPhrases) {
    if (phr === "FREE") continue;
    const key = phr.normalize("NFC");
    if (called.has(key) && !localMarked.has(key)) {
      localMarked.add(key);
      changed = true;
    }
  }
  if (changed) saveMarks();
}
function tryAutoCallBingo() {
  if (getAutoCalled()) return;
  const res = hasBingoLocally();
  if (res.ok) {
    socket.emit("bingo:call", { name });
    setAutoCalled(true);
  }
}
function renderAutoPlayButton() {
  const on = getAutoPlayEnabled();
  autoPlayBtn.textContent = `Auto Play: ${on ? "ON" : "OFF"}`;
  autoPlayBtn.className = "px-3 py-2 rounded-xl border " + (on
    ? "border-emerald-600 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
    : "border-slate-300 hover:bg-slate-100");
}

// --- Rendering ---
function renderAll() {
  renderSeedDate();
  renderCard();
  renderLists();
  renderBingoCalls();
  renderPlayers();
}
function renderSeedDate() {
  seedDateEl.textContent = roundKey ? `(seed ${roundKey} UTC)` : "";
}

function renderCard() {
  cardGrid.innerHTML = "";
  if (cardPhrases.length !== 25) {
    const warn = document.createElement("div");
    warn.className = "p-4 bg-amber-50 border border-amber-200 rounded-xl";
    warn.textContent = "Need at least 25 unique phrases in phrases.txt to build a card.";
    cardGrid.appendChild(warn);
    return;
  }

  cardPhrases.forEach((phrase, idx) => {
    const key = phrase.normalize("NFC");
    const isFree = key === "FREE";
    const isCalled = isFree ? true : called.has(key);
    const isMarked = isFree ? true : localMarked.has(key);

    const tile = document.createElement("div");
    tile.className = "tile shadow text-sm";

    if (isCalled && isMarked) tile.classList.add("called-marked");
    else if (!isCalled && isMarked) tile.classList.add("marked");
    else if (isCalled && !isMarked) tile.classList.add("called-unmarked");

    if (myWinningIndices.has(idx)) {
      tile.classList.add("winning");
    }

    tile.innerHTML = `<div class="${isFree ? "italic text-slate-700" : ""}">${phrase}</div>`;

    if (!isFree) {
      tile.style.cursor = "pointer";
      tile.title = "Toggle your personal mark (does not call)";
      tile.addEventListener("click", () => {
        if (localMarked.has(key)) localMarked.delete(key);
        else localMarked.add(key);
        saveMarks();
        renderCard();
      });
    }

    cardGrid.appendChild(tile);
  });
}

function renderLists() {
  calledList.innerHTML = "";
  availableList.innerHTML = "";

  const calledArr = phrases.filter((p) => called.has(p));
  const availArr = phrases.filter((p) => !called.has(p));

  // Called
  calledArr.forEach((p) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between p-2 rounded-xl border bg-white border-green-300";

    const label = document.createElement("div");
    label.className = "text-sm";
    label.textContent = p;

    const btn = document.createElement("button");
    btn.className = "text-xs px-2 py-1 border rounded border-green-700 text-green-800 hover:bg-green-100";
    btn.textContent = "Uncall";
    btn.addEventListener("click", () => {
      socket.emit("phrase:uncall", { phrase: p.normalize("NFC") });
    });

    row.appendChild(label);
    row.appendChild(btn);
    calledList.appendChild(row);
  });

  // Available
  availArr.forEach((p) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between p-2 rounded-xl border bg-white border-slate-200 hover:bg-slate-50";

    const label = document.createElement("div");
    label.className = "text-sm";
    label.textContent = p;

    const btn = document.createElement("button");
    btn.className = "text-xs px-2 py-1 border rounded border-slate-400 text-slate-700";
    btn.textContent = "Call";
    btn.addEventListener("click", () => {
      socket.emit("phrase:call", { phrase: p.normalize("NFC") });
    });

    row.appendChild(label);
    row.appendChild(btn);
    availableList.appendChild(row);
  });
}

function renderBingoCalls() {
  bingoCallsEl.innerHTML = "";
  if (!bingoCalls.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-500";
    empty.textContent = "No calls yet.";
    bingoCallsEl.appendChild(empty);
    return;
  }
  bingoCalls.forEach((c) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between p-2 rounded-xl border bg-white border-slate-200";
    const left = document.createElement("div");
    left.className = "text-sm";
    const time = new Date(c.time || Date.now()).toLocaleTimeString();
    left.textContent = `${c.name} • ${time}`;
    const badge = document.createElement("span");
    badge.className = "text-xs px-2 py-0.5 rounded-full " +
      (c.valid ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
               : "bg-rose-100 text-rose-800 border border-rose-300");
    badge.textContent = c.valid ? "Valid ✓" : "Invalid ✗";
    row.appendChild(left);
    row.appendChild(badge);
    bingoCallsEl.appendChild(row);
  });
}

function renderPlayers() {
  playersListEl.innerHTML = "";
  if (!players.length) {
    const empty = document.createElement("div");
    empty.className = "text-sm text-slate-500";
    empty.textContent = "No one yet.";
    playersListEl.appendChild(empty);
    return;
  }
  players.forEach((p) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = p;
    playersListEl.appendChild(pill);
  });
}

// --- Events ---
loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const n = displayNameInput.value.trim();
  if (n) {
    doLogin(n).catch((err) => alert(err.message || "Login failed"));
  }
});

switchUser.addEventListener("click", () => {
  localStorage.removeItem("displayName");
  document.cookie = "displayName=; Max-Age=0; path=/";
  name = "";
  if (socket) socket.disconnect();
  showLogin();
});

callBingoBtn.addEventListener("click", () => {
  if (!name) return alert("Please enter a name first.");
  socket.emit("bingo:call", { name });
});

// Auto play toggle
autoPlayBtn.addEventListener("click", () => {
  const newVal = !getAutoPlayEnabled();
  setAutoPlayEnabled(newVal);
  renderAutoPlayButton();
  if (newVal) {
    autoMarkCalled();
    tryAutoCallBingo();
    renderCard();
  }
});

// Clear Card: remove all personal marks; also turn Auto Play OFF so marks don't reappear immediately
clearCardBtn.addEventListener("click", () => {
  localMarked.clear();
  saveMarks();
  myWinningIndices = new Set();
  if (getAutoPlayEnabled()) {
    setAutoPlayEnabled(false);
    renderAutoPlayButton();
  }
  setAutoCalled(false);
  renderCard();
});

// --- Boot ---
if (name) {
  showMain();
  connectSocket();
  initialLoad();
} else {
  showLogin();
}
