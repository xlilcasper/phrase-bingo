import { state, storage } from "./state.js";
import { renderAll, renderBingoCalls, renderCard, renderCallBingoGlow } from "./render.js";
import { launchConfetti } from "./confetti.js";

export function connectSocket() {
    if (state.socket) state.socket.disconnect();
    state.socket = io();

    state.socket.on("connect_error", (err) => console.error("socket connect_error", err));

    state.socket.on("connect", () => {
        if (state.name) state.socket.emit("player:join", { name: state.name });
    });

    state.socket.on("players:update", ({ players }) => {
        state.players = Array.isArray(players) ? players : [];
        renderAll();
    });

    state.socket.on("phrases:update", ({ phrases, called, roundKey }) => {
        state.phrases = phrases.map((s) => s.normalize("NFC"));
        state.called = new Set((called || []).map((s) => s.normalize("NFC")));

        // New round → reset per-round flags
        if (roundKey && roundKey !== state.roundKey) {
            state.roundKey = roundKey;
            storage.loadMarks();
            state.myWinningIndices = new Set();
            storage.setAutoCalled(false);
            state.lastWinTimestamp = 0;
            state.initialCardRendered = false;
            state.alreadyCalledBingo = false; // allow glow next time we have a bingo
        }

        ensureCard();

        if (storage.getAutoPlay()) {
            autoMarkCalled();
            tryAutoCallBingo(); // will set flag + glow off when it fires
        }

        renderAll();
    });

    // Full bingo calls list update
    state.socket.on("bingo:update", ({ calls }) => {
        state.bingoCalls = (calls || []).slice().sort((a, b) => a.time - b.time);

        // If we have a (valid) call in the list, save indices and celebrate
        const entry = state.bingoCalls.filter(c => c.name === state.name && c.valid).pop();
        const prevHadWin = state.myWinningIndices.size > 0;
        if (entry && Array.isArray(entry.indices)) {
            state.myWinningIndices = new Set(entry.indices);
            if (!prevHadWin || (entry.time && entry.time !== state.lastWinTimestamp)) {
                state.lastWinTimestamp = entry.time || Date.now();
                launchConfetti(900);
            }
            // We’ve called (and it’s valid) → ensure glow is off
            state.alreadyCalledBingo = true;
            renderCallBingoGlow();
        } else {
            state.myWinningIndices = new Set();
        }

        renderBingoCalls();
        renderCard();
    });

    // Optional: single-call event from server (if your backend emits one)
    state.socket.on("bingo:called", (payload = {}) => {
        if (payload.name === state.name) {
            state.alreadyCalledBingo = true;
            renderCallBingoGlow();
        }
    });
}

// Helpers local to this module:
import { shuffleDeterministic } from "./rng.js";
import { hasBingoLocally } from "./render.js";

function ensureCard() {
    if (!state.roundKey || state.phrases.length < 25) {
        state.cardPhrases = [];
        return;
    }
    const shuffled = shuffleDeterministic(state.phrases, `${state.name || "guest"}|${state.roundKey}`);
    const first25 = shuffled.slice(0, 25).map(s => s.normalize("NFC"));
    first25[12] = "FREE";
    state.cardPhrases = first25;
}

function autoMarkCalled() {
    if (state.cardPhrases.length !== 25) return;
    let changed = false;
    for (const phr of state.cardPhrases) {
        if (phr === "FREE") continue;
        const key = phr.normalize("NFC");
        if (state.called.has(key) && !state.localMarked.has(key)) {
            state.localMarked.add(key);
            changed = true;
        }
    }
    if (changed) storage.saveMarks();
}

function tryAutoCallBingo() {
    if (storage.getAutoCalled()) return;
    const res = hasBingoLocally();
    if (res.ok) {
        state.socket.emit("bingo:call", { name: state.name });
        storage.setAutoCalled(true);
        // Also stop the glow on this client for auto-call
        state.alreadyCalledBingo = true;
        renderCallBingoGlow();
    }
}
