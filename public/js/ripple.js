export function spawnRipple(ev, hostEl) {
    const rect = hostEl.getBoundingClientRect();
    const ink = document.createElement("span");
    ink.className = "ripple-ink";
    const size = Math.max(rect.width, rect.height);
    const x = (ev.clientX - rect.left) - size/2;
    const y = (ev.clientY - rect.top) - size/2;
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${x}px`;
    ink.style.top = `${y}px`;
    hostEl.appendChild(ink);
    setTimeout(() => ink.remove(), 520);
}
