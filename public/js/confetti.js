import { dom } from "./state.js";

let confettiRAF = null;

function resizeCanvas() {
    dom.confettiCanvas.width = window.innerWidth;
    dom.confettiCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);

export function launchConfetti(durationMs = 1000) {
    resizeCanvas();
    dom.confettiCanvas.classList.remove("hidden");
    const ctx = dom.confettiCtx;

    const colors = ["#10b981","#22c55e","#eab308","#38bdf8","#6366f1","#f43f5e"];
    const pieces = Array.from({ length: 140 }, () => ({
        x: Math.random() * dom.confettiCanvas.width,
        y: -20 + Math.random() * 20,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 12,
        vy: 2 + Math.random() * 3,
        vx: -1 + Math.random() * 2,
        r: Math.random() * Math.PI,
        vr: (-0.2 + Math.random() * 0.4),
        c: colors[Math.floor(Math.random() * colors.length)],
    }));

    const start = performance.now();
    cancelAnimationFrame(confettiRAF);

    function tick(now) {
        const t = now - start;
        ctx.clearRect(0, 0, dom.confettiCanvas.width, dom.confettiCanvas.height);

        for (const p of pieces) {
            p.vy += 0.02;
            p.x += p.vx; p.y += p.vy; p.r += p.vr;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
            ctx.fillStyle = p.c; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
            ctx.restore();
        }
        if (t < durationMs) confettiRAF = requestAnimationFrame(tick);
        else dom.confettiCanvas.classList.add("hidden");
    }
    confettiRAF = requestAnimationFrame(tick);
}
