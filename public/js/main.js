import { state, dom, storage, getCookie, initDom } from "./state.js";
import { apiLogin, fetchInitial } from "./api.js";
import { connectSocket } from "./socket.js";
import { renderAll, renderAutoPlayButton, applyTileClasses, renderCallBingoGlow, renderLists } from "./render.js";
import { spawnRipple } from "./ripple.js";

// Build the same card again using the existing daily seed + name
async function rebuildCardWithSameSeed() {
    if (!state.roundKey || state.phrases.length < 25) {
        state.cardPhrases = [];
        return;
    }
    const { shuffleDeterministic } = await import("./rng.js");
    const first25 = shuffleDeterministic(
        state.phrases,
        `${state.name || "guest"}|${state.roundKey}`
    ).slice(0, 25);
    first25[12] = "FREE";
    state.cardPhrases = first25.map(s => s.normalize("NFC"));
}

function showLogin() {
    dom.loginPanel.classList.remove("hidden");
    dom.mainPanel.classList.add("hidden");
}
function showMain() {
    dom.loginPanel.classList.add("hidden");
    dom.mainPanel.classList.remove("hidden");
    dom.whoami.textContent = state.name;
    renderAutoPlayButton();
}

async function doLogin(n) {
    const clean = String(n || "").trim();
    if (!clean) return;
    await apiLogin(clean);
    localStorage.setItem("displayName", clean);
    state.name = clean;
    dom.whoami.textContent = state.name;
    showMain();
    connectSocket();
    await initialLoad();
}

async function initialLoad() {
    const data = await fetchInitial();
    state.phrases = data.phrases.map((s) => s.normalize("NFC"));
    state.called = new Set((data.called || []).map((s) => s.normalize("NFC")));
    state.roundKey = data.roundKey;
    storage.loadMarks();
    state.myWinningIndices = new Set();
    storage.setAutoCalled(false);
    state.initialCardRendered = false;
    state.alreadyCalledBingo = false;

    await rebuildCardWithSameSeed();

    if (storage.getAutoPlay()) {
        for (const phr of state.cardPhrases) {
            if (phr !== "FREE" && state.called.has(phr)) state.localMarked.add(phr);
        }
        storage.setAutoCalled(false);
    }

    renderAll();
}

function localResetGame() {
    // Clear all per-game state locally (keep roundKey the same)
    state.called = new Set();               // nothing is called now
    state.bingoCalls = [];                  // clear calls list
    state.localMarked.clear();              // clear marks
    state.myWinningIndices = new Set();     // clear win highlight
    state.lastWinTimestamp = 0;
    state.alreadyCalledBingo = false;       // stop button glow
    storage.setAutoCalled(false);
    storage.saveMarks();

    // Re-render everything immediately
    renderAll();
    renderCallBingoGlow();
    renderLists(); // keep Available highlighting/order in sync
}

// Wire UI events (run after DOM is ready)
function wireUi() {
    dom.loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const n = dom.displayName.value.trim();
        if (!n) return;
        doLogin(n).catch((err) => alert(err.message || "Login failed"));
    });

    dom.switchUser.addEventListener("click", (ev) => {
        spawnRipple(ev, dom.switchUser);
        localStorage.removeItem("displayName");
        document.cookie = "displayName=; Max-Age=0; path=/";
        state.name = "";
        if (state.socket) state.socket.disconnect();
        showLogin();
    });

    dom.callBingoBtn.addEventListener("click", (ev) => {
        spawnRipple(ev, dom.callBingoBtn);
        if (!state.name) return alert("Please enter a name first.");
        state.socket.emit("bingo:call", { name: state.name });
        state.alreadyCalledBingo = true;    // stop glowing immediately
        renderCallBingoGlow();
    });

    dom.autoPlayBtn.addEventListener("click", (ev) => {
        spawnRipple(ev, dom.autoPlayBtn);
        const newVal = !storage.getAutoPlay();
        storage.setAutoPlay(newVal);
        renderAutoPlayButton();
        if (newVal) {
            document.querySelectorAll("#card .tile").forEach((tile) => {
                const idx = Number(tile.dataset.index || "0");
                const key = state.cardPhrases[idx].normalize("NFC");
                if (key !== "FREE" && state.called.has(key)) state.localMarked.add(key);
                applyTileClasses(tile, key, idx);
            });
        }
        renderLists();
        storage.saveMarks();
    });

    dom.clearCardBtn.addEventListener("click", (ev) => {
        spawnRipple(ev, dom.clearCardBtn);
        state.localMarked.clear();
        state.myWinningIndices = new Set();
        state.alreadyCalledBingo = false;
        if (storage.getAutoPlay()) {
            storage.setAutoPlay(false);
            renderAutoPlayButton();
        }
        storage.setAutoCalled(false);
        storage.saveMarks();

        document.querySelectorAll("#card .tile").forEach((tile) => {
            const idx = Number(tile.dataset.index || "0");
            const key = state.cardPhrases[idx].normalize("NFC");
            applyTileClasses(tile, key, idx);
        });

        renderCallBingoGlow();
        renderLists();
    });

    // ---- Reset Game (Hold to Confirm) ----
    wireResetGame();
}

// Hold-to-confirm reset modal logic
function wireResetGame() {
    const modal = dom.resetConfirmModal;
    const resetBtn = dom.resetGameBtn;
    const cancelBtn = dom.cancelResetBtn;
    const confirmBtn = dom.confirmResetBtn;

    let holdTimer = null;
    let holding = false;

    function openModal() {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
        cancelBtn.focus({ preventScroll: true });
    }
    function closeModal() {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
        stopHold();
    }
    function startHold() {
        if (holding) return;
        holding = true;
        confirmBtn.classList.add("holding");
        holdTimer = setTimeout(async () => {
            // 1) Rebuild the SAME card (same daily seed)
            await rebuildCardWithSameSeed();
            // 2) Reset locally (immediate UX)
            localResetGame();
            // 3) Notify server (optional; no server change required for local UX)
            if (state.socket) state.socket.emit("game:reset");
            // 4) Close modal
            closeModal();
        }, 2200); // 2.2s
    }
    function stopHold() {
        holding = false;
        confirmBtn.classList.remove("holding");
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    }

    resetBtn.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);

    // Pointer + touch support
    confirmBtn.addEventListener("mousedown", startHold);
    confirmBtn.addEventListener("mouseup", stopHold);
    confirmBtn.addEventListener("mouseleave", stopHold);

    confirmBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startHold(); }, { passive: false });
    ["touchend","touchcancel"].forEach(ev => confirmBtn.addEventListener(ev, stopHold));
}

// Boot once DOM is ready so all IDs exist
document.addEventListener("DOMContentLoaded", () => {
    initDom();         // bind elements
    state.name = getCookie("displayName") || localStorage.getItem("displayName") || "";
    wireUi();

    if (state.name) {
        showMain();
        connectSocket();
        initialLoad().catch((e) => alert(e.message || "Failed to load"));
    } else {
        showLogin();
    }
});
