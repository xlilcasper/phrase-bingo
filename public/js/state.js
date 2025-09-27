// Central app state + persistence helpers

export const state = {
    socket: null,
    name: "",
    phrases: [],
    called: new Set(),
    roundKey: null,
    cardPhrases: [],
    localMarked: new Set(),
    bingoCalls: [],
    players: [],
    myWinningIndices: new Set(),
    lastWinTimestamp: 0,
    initialCardRendered: false,
    alreadyCalledBingo: false, // used for glow gating
};

// We'll bind these AFTER the DOM is ready
export const dom = {
    loginPanel: null,
    loginForm: null,
    displayName: null,
    mainPanel: null,
    whoami: null,
    cardGrid: null,
    seedDateEl: null,
    calledList: null,
    availableList: null,
    bingoCallsEl: null,
    playersListEl: null,
    switchUser: null,
    callBingoBtn: null,
    autoPlayBtn: null,
    clearCardBtn: null,
    resetGameBtn: null,        // NEW
    resetConfirmModal: null,   // NEW
    cancelResetBtn: null,      // NEW
    confirmResetBtn: null,     // NEW
    confettiCanvas: null,
    confettiCtx: null,
};

// Call once on DOMContentLoaded
export function initDom() {
    dom.loginPanel = document.getElementById("loginPanel");
    dom.loginForm = document.getElementById("loginForm");
    dom.displayName = document.getElementById("displayName");
    dom.mainPanel = document.getElementById("mainPanel");
    dom.whoami = document.getElementById("whoami");
    dom.cardGrid = document.getElementById("card");
    dom.seedDateEl = document.getElementById("seedDate");
    dom.calledList = document.getElementById("calledList");
    dom.availableList = document.getElementById("availableList");
    dom.bingoCallsEl = document.getElementById("bingoCalls");
    dom.playersListEl = document.getElementById("playersList");
    dom.switchUser = document.getElementById("switchUser");
    dom.callBingoBtn = document.getElementById("callBingoBtn");
    dom.autoPlayBtn = document.getElementById("autoPlayBtn");
    dom.clearCardBtn = document.getElementById("clearCardBtn");
    dom.resetGameBtn = document.getElementById("resetGameBtn");              // NEW
    dom.resetConfirmModal = document.getElementById("resetConfirmModal");    // NEW
    dom.cancelResetBtn = document.getElementById("cancelResetBtn");          // NEW
    dom.confirmResetBtn = document.getElementById("confirmResetBtn");        // NEW
    dom.confettiCanvas = document.getElementById("confetti");
    dom.confettiCtx = dom.confettiCanvas ? dom.confettiCanvas.getContext("2d") : null;

    // Helpful assertion to catch missing IDs early
    const required = [
        "loginPanel","loginForm","displayName","mainPanel","whoami","card",
        "seedDate","calledList","availableList","bingoCalls","playersList",
        "switchUser","callBingoBtn","autoPlayBtn","clearCardBtn","confetti",
        "resetGameBtn","resetConfirmModal","cancelResetBtn","confirmResetBtn" // NEW
    ];
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length) {
        console.error("Missing required element IDs in index.html:", missing);
        throw new Error("Missing required DOM elements: " + missing.join(", "));
    }
}

export function getCookie(name) {
    return document.cookie.split("; ").reduce((acc, part) => {
        const [k, v] = part.split("=");
        if (k === name) acc = decodeURIComponent(v || "");
        return acc;
    }, "");
}

// Keys depend on current player+round
export const storage = {
    autoPlayKey: () => `bingAutoPlay:${state.name}|${state.roundKey}`,
    autoCalledKey: () => `bingAutoCalled:${state.name}|${state.roundKey}`,
    marksKey: () => `bingSelected:${state.name}|${state.roundKey}`,
    getAutoPlay: () => localStorage.getItem(storage.autoPlayKey()) === "1",
    setAutoPlay: (v) => localStorage.setItem(storage.autoPlayKey(), v ? "1" : "0"),
    getAutoCalled: () => localStorage.getItem(storage.autoCalledKey()) === "1",
    setAutoCalled: (v) => localStorage.setItem(storage.autoCalledKey(), v ? "1" : "0"),
    loadMarks() {
        try {
            const raw = localStorage.getItem(storage.marksKey());
            state.localMarked = new Set(raw ? JSON.parse(raw) : []);
        } catch { state.localMarked = new Set(); }
    },
    saveMarks() {
        try { localStorage.setItem(storage.marksKey(), JSON.stringify([...state.localMarked])); } catch {}
    },
};
