import { state, dom, storage, getCookie, initDom } from "./state.js";
import { apiLogin, fetchInitial } from "./api.js";
import { connectSocket } from "./socket.js";
import { renderAll, renderAutoPlayButton, applyTileClasses, renderCallBingoGlow, renderLists } from "./render.js";
import { spawnRipple } from "./ripple.js";

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

    // Build card once; socket.js will rebuild on updates
    if (state.roundKey && state.phrases.length >= 25) {
        const { shuffleDeterministic } = await import("./rng.js");
        const first25 = shuffleDeterministic(state.phrases, `${state.name || "guest"}|${state.roundKey}`).slice(0,25);
        first25[12] = "FREE";
        state.cardPhrases = first25.map(s => s.normalize("NFC"));
    } else {
        state.cardPhrases = [];
    }

    if (storage.getAutoPlay()) {
        for (const phr of state.cardPhrases) {
            if (phr !== "FREE" && state.called.has(phr)) state.localMarked.add(phr);
        }
        storage.setAutoCalled(false);
    }

    renderAll();
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

        // Tell server
        state.socket.emit("bingo:call", { name: state.name });

        // Stop glowing immediately on this client
        state.alreadyCalledBingo = true;
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
        // Keep Available list in sync (highlight + ordering)
        renderLists();
        storage.saveMarks();
    });

    dom.clearCardBtn.addEventListener("click", (ev) => {
        spawnRipple(ev, dom.clearCardBtn);
        state.localMarked.clear();
        state.myWinningIndices = new Set();
        state.alreadyCalledBingo = false;   // reset the bingo flag
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

        // also refresh glow state so button updates immediately
        import("./render.js").then(m => m.renderCallBingoGlow());

        // reflect list state too
        renderLists();
    });
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
