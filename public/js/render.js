import { state, dom, storage } from "./state.js";
import { spawnRipple } from "./ripple.js"; // still used for buttons

const LINES = (() => {
    const rows = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => r * 5 + c));
    const cols = Array.from({ length: 5 }, (_, c) => Array.from({ length: 5 }, (_, r) => r * 5 + c));
    const diag1 = [0, 6, 12, 18, 24];
    const diag2 = [4, 8, 12, 16, 20];
    return [...rows, ...cols, diag1, diag2];
})();

export function hasBingoLocally() {
    if (state.cardPhrases.length !== 25) return { ok: false, line: [] };
    for (const line of LINES) {
        let ok = true;
        for (const idx of line) {
            const phr = state.cardPhrases[idx];
            if (phr !== "FREE" && !state.called.has(phr)) { ok = false; break; }
        }
        if (ok) return { ok: true, line };
    }
    return { ok: false, line: [] };
}

export function renderAll() {
    renderSeedDate();
    renderCard();
    renderLists();
    renderBingoCalls();
    renderPlayers();
    renderAutoPlayButton();
    renderCallBingoGlow();
}

export function renderSeedDate() {
    dom.seedDateEl.textContent = state.roundKey ? `(seed ${state.roundKey} UTC)` : "";
}

export function applyTileClasses(tile, key, idx) {
    tile.classList.remove("marked","called-marked","called-unmarked","winning");
    const isFree = key === "FREE";
    const isCalled = isFree ? true : state.called.has(key);
    const isMarked = isFree ? true : state.localMarked.has(key);

    if (isCalled && isMarked) tile.classList.add("called-marked");
    else if (!isCalled && isMarked) tile.classList.add("marked");
    else if (isCalled && !isMarked) tile.classList.add("called-unmarked");

    if (state.myWinningIndices.has(idx)) tile.classList.add("winning");
}

// render.js
export function renderCard() {
    // If card isn't buildable, keep your existing warning path
    if (state.cardPhrases.length !== 25) {
        dom.cardGrid.innerHTML = "";
        const warn = document.createElement("div");
        warn.className = "p-4 bg-amber-50 border border-amber-200 rounded-xl";
        warn.textContent = "Need at least 25 unique phrases in phrases.txt to build a card.";
        dom.cardGrid.appendChild(warn);
        state.initialCardRendered = false;
        return;
    }

    const alreadyBuilt = state.initialCardRendered &&
        dom.cardGrid.querySelectorAll(".tile").length === 25;

    if (!alreadyBuilt) {
        // BUILD ONCE
        dom.cardGrid.innerHTML = "";

        state.cardPhrases.forEach((phrase, idx) => {
            const key = phrase.normalize("NFC");
            const isFree = key === "FREE";

            const wrapper = document.createElement("div");
            wrapper.className = "tile-anim";

            const tile = document.createElement("div");
            // FIX: only add "free" class when it is actually the FREE tile
            tile.className = "tile shadow text-sm" + (isFree ? " free" : "");
            tile.dataset.index = String(idx);
            tile.innerHTML = isFree
                ? `<div class="free"><span class="free-label">FREE</span></div>`
                : `<div>${phrase}</div>`;

            if (state.initialCardRendered) tile.style.animation = "none";
            else tile.style.animationDelay = `${(idx % 5) * 20 + Math.floor(idx / 5) * 20}ms`;

            applyTileClasses(tile, key, idx);

            if (!isFree) {
                tile.style.cursor = "pointer";
                tile.title = "Toggle your personal mark (does not call)";
                tile.addEventListener("click", () => {
                    if (state.localMarked.has(key)) state.localMarked.delete(key);
                    else state.localMarked.add(key);
                    storage.saveMarks();

                    applyTileClasses(tile, key, idx);

                    wrapper.classList.remove("tile-wiggle");
                    wrapper.offsetWidth; // reflow
                    wrapper.classList.add("tile-wiggle");
                });
            }

            wrapper.appendChild(tile);
            dom.cardGrid.appendChild(wrapper);
        });

        state.initialCardRendered = true;
        return; // done with initial build
    }

    // UPDATE MODE (no rebuild): just apply classes so transitions can run
    state.cardPhrases.forEach((phrase, idx) => {
        const key = phrase.normalize("NFC");
        const tile = dom.cardGrid.querySelector(`.tile[data-index="${idx}"]`);
        if (tile) applyTileClasses(tile, key, idx);
    });
}


export function renderLists() {
    dom.calledList.innerHTML = "";
    dom.availableList.innerHTML = "";

    const calledArr = state.phrases.filter((p) => state.called.has(p));
    const availArr = state.phrases.filter((p) => !state.called.has(p));

    // Called
    calledArr.forEach((p) => {
        const row = document.createElement("div");
        row.className = "list-row flex items-center justify-between p-2 rounded-xl border bg-white border-green-300";
        const label = document.createElement("div");
        label.className = "text-sm"; label.textContent = p;
        const btn = document.createElement("button");
        btn.className = "text-xs px-2 py-1 border rounded border-green-700 text-green-800 hover:bg-green-100 transition ripple";
        btn.textContent = "Uncall";
        btn.addEventListener("click", (ev) => {
            spawnRipple(ev, btn);
            state.socket.emit("phrase:uncall", { phrase: p.normalize("NFC") });
        });
        row.append(label, btn);
        dom.calledList.appendChild(row);
    });

    // Available
    availArr.forEach((p) => {
        const row = document.createElement("div");
        row.className = "list-row flex items-center justify-between p-2 rounded-xl border bg-white border-slate-200 hover:bg-slate-50 transition";
        const label = document.createElement("div");
        label.className = "text-sm"; label.textContent = p;
        const btn = document.createElement("button");
        btn.className = "text-xs px-2 py-1 border rounded border-slate-400 text-slate-700 hover:bg-slate-100 transition ripple";
        btn.textContent = "Call";
        btn.addEventListener("click", (ev) => {
            spawnRipple(ev, btn);
            state.socket.emit("phrase:call", { phrase: p.normalize("NFC") });
        });
        row.append(label, btn);
        dom.availableList.appendChild(row);
    });
}

export function renderBingoCalls() {
    dom.bingoCallsEl.innerHTML = "";
    if (!state.bingoCalls.length) {
        const empty = document.createElement("div");
        empty.className = "text-sm text-slate-500";
        empty.textContent = "No calls yet.";
        dom.bingoCallsEl.appendChild(empty);
        return;
    }
    state.bingoCalls.forEach((c) => {
        const row = document.createElement("div");
        row.className = "list-row flex items-center justify-between p-2 rounded-xl border bg-white border-slate-200";
        const left = document.createElement("div");
        left.className = "text-sm";
        const time = new Date(c.time || Date.now()).toLocaleTimeString();
        left.textContent = `${c.name} • ${time}`;
        const badge = document.createElement("span");
        badge.className = "text-xs px-2 py-0.5 rounded-full " +
            (c.valid ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                : "bg-rose-100 text-rose-800 border border-rose-300");
        badge.textContent = c.valid ? "Valid ✓" : "Invalid ✗";
        row.append(left, badge);
        dom.bingoCallsEl.appendChild(row);
    });
}

export function renderPlayers() {
    dom.playersListEl.innerHTML = "";
    if (!state.players.length) {
        const empty = document.createElement("div");
        empty.className = "text-sm text-slate-500";
        empty.textContent = "No one yet.";
        dom.playersListEl.appendChild(empty);
        return;
    }
    state.players.forEach((p) => {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = p;
        dom.playersListEl.appendChild(pill);
    });
}

export function renderAutoPlayButton() {
    const on = storage.getAutoPlay();
    dom.autoPlayBtn.textContent = `Auto Play: ${on ? "ON" : "OFF"}`;
    dom.autoPlayBtn.className = "btn-outline ripple " + (on ? "ring-2 ring-emerald-200" : "");
}

state.alreadyCalledBingo = state.alreadyCalledBingo ?? false;

export function renderCallBingoGlow() {
    const { ok } = hasBingoLocally();
    const shouldGlow = ok && !state.alreadyCalledBingo;
    if (dom.callBingoBtn) dom.callBingoBtn.classList.toggle("btn-glow", shouldGlow);
}

if (dom.callBingoBtn) {
    dom.callBingoBtn.addEventListener("click", () => {
        state.alreadyCalledBingo = true;
        renderCallBingoGlow();
        state.socket.emit("bingo:call", { name: state.myName, time: Date.now() });
    });
}
