export async function apiLogin(name) {
    const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
    });
    if (!res.ok) {
        let msg = "login failed";
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
    }
    return res.json();
}

export async function fetchInitial() {
    const res = await fetch("/api/phrases");
    if (!res.ok) throw new Error("Failed to load phrases");
    return res.json();
}
