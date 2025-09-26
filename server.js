import fs from "fs";
import http from "http";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { Server as SocketIOServer } from "socket.io";

const __dirname = path.resolve();
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// --- Date helpers ---
function todayUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function currentRoundKey(req) {
  if (req?.query?.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
    return req.query.date;
  }
  return process.env.DAILY_DATE || todayUTC();
}
function activeRoundKey() {
  return process.env.DAILY_DATE || todayUTC();
}

// --- Deterministic shuffle (same as client) ---
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

// --- Phrases ---
function loadPhrases() {
  const file = path.join(__dirname, "phrases.txt");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  const raw = fs.readFileSync(file, "utf8");

  const seen = new Set();
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const norm = s.normalize("NFC");
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

let phrases = loadPhrases();
let called = new Set();

// Bingo calls for the current roundKey
let bingoCalls = new Map();

// Live players: socket.id -> name
const playersBySocket = new Map();
function broadcastPlayers() {
  const unique = [...new Set(playersBySocket.values())].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  io.emit("players:update", { players: unique });
}

// Watch phrases file for changes
const PHRASE_FILE = path.join(__dirname, "phrases.txt");
fs.watch(PHRASE_FILE, { persistent: false }, () => {
  try {
    phrases = loadPhrases();
    called = new Set([...called].filter((p) => phrases.includes(p)));
    io.emit("phrases:update", { phrases, called: [...called], roundKey: activeRoundKey() });
    revalidateAllBingos();
  } catch (e) {
    console.error("reload error", e);
  }
});

// --- API ---
app.post("/api/login", (req, res) => {
  const { name } = req.body || {};
  const clean = String(name || "").trim().slice(0, 40);
  if (!clean) return res.status(400).json({ error: "Name required" });
  if (/[<>]/.test(clean)) return res.status(400).json({ error: "Invalid characters" });
  res.cookie("displayName", clean, { httpOnly: false, sameSite: "Lax" });
  res.json({ ok: true, name: clean });
});

app.get("/api/phrases", (req, res) => {
  res.json({
    phrases,
    called: [...called],
    roundKey: currentRoundKey(req),
  });
});

// --- Bingo helpers ---
function makeCardFor(name, roundKey) {
  if (phrases.length < 25) return null;
  const seed = `${name}|${roundKey}`;
  const shuffled = shuffleDeterministic(phrases, seed);
  const first25 = shuffled.slice(0, 25);
  first25[12] = "FREE";
  return first25;
}

const LINES = (() => {
  const rows = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => r * 5 + c));
  const cols = Array.from({ length: 5 }, (_, c) => Array.from({ length: 5 }, (_, r) => r * 5 + c));
  const diag1 = [0, 6, 12, 18, 24];
  const diag2 = [4, 8, 12, 16, 20];
  return [
    ...rows.map((idxs) => ({ type: "row", idxs })),
    ...cols.map((idxs) => ({ type: "col", idxs })),
    { type: "diag", idxs: diag1 },
    { type: "diag", idxs: diag2 },
  ];
})();

function validateBingoFor(name, roundKey) {
  const card = makeCardFor(name, roundKey);
  if (!card) return { valid: false, lineType: null, indices: [] };
  for (const line of LINES) {
    const ok = line.idxs.every((i) => card[i] === "FREE" || called.has(card[i]));
    if (ok) return { valid: true, lineType: line.type, indices: line.idxs };
  }
  return { valid: false, lineType: null, indices: [] };
}

function revalidateAllBingos() {
  const rk = activeRoundKey();
  let changed = false;
  for (const [name, entry] of bingoCalls.entries()) {
    const res = validateBingoFor(name, rk);
    const newEntry = { ...entry, valid: res.valid, lineType: res.lineType, indices: res.indices };
    if (
      entry.valid !== newEntry.valid ||
      entry.lineType !== newEntry.lineType ||
      (entry.indices || []).join(",") !== (newEntry.indices || []).join(",")
    ) {
      bingoCalls.set(name, newEntry);
      changed = true;
    }
  }
  if (changed) io.emit("bingo:update", { calls: [...bingoCalls.values()] });
}

// --- Sockets ---
io.on("connection", (socket) => {
  const rk = activeRoundKey();
  socket.emit("phrases:update", { phrases, called: [...called], roundKey: rk });
  socket.emit("bingo:update", { calls: [...bingoCalls.values()] });
  broadcastPlayers(); // let newcomers see current list

  function extractPhrase(payload) {
    const raw = typeof payload === "string" ? payload : payload?.phrase;
    if (!raw) return null;
    return String(raw).trim().normalize("NFC");
  }

  // Player join/leave
  socket.on("player:join", (payload) => {
    const nameRaw = typeof payload === "string" ? payload : payload?.name;
    const clean = String(nameRaw || "").trim().slice(0, 40);
    if (!clean) return;
    playersBySocket.set(socket.id, clean);
    broadcastPlayers();
  });

  socket.on("disconnect", () => {
    playersBySocket.delete(socket.id);
    broadcastPlayers();
  });

  // Call/uncall phrases
  socket.on("phrase:call", (payload) => {
    const phrase = extractPhrase(payload);
    if (!phrase || !phrases.includes(phrase)) return;
    if (!called.has(phrase)) {
      called.add(phrase);
      io.emit("phrases:update", { phrases, called: [...called], roundKey: rk });
      revalidateAllBingos();
    }
  });

  socket.on("phrase:uncall", (payload) => {
    const phrase = extractPhrase(payload);
    if (!phrase || !phrases.includes(phrase)) return;
    if (called.has(phrase)) {
      called.delete(phrase);
      io.emit("phrases:update", { phrases, called: [...called], roundKey: rk });
      revalidateAllBingos();
    }
  });

  // Bingo call
  socket.on("bingo:call", (payload) => {
    const nameRaw = (payload && payload.name) ? String(payload.name) : "";
    const cleanName = nameRaw.trim().slice(0, 40) || "Guest";
    const res = validateBingoFor(cleanName, rk);
    const entry = {
      name: cleanName,
      valid: res.valid,
      lineType: res.lineType,
      indices: res.indices,
      time: Date.now(),
    };
    bingoCalls.set(cleanName, entry);
    io.emit("bingo:update", { calls: [...bingoCalls.values()] });
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
