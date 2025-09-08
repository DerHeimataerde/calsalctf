// seed-ctfd.js (ESM) — Node 18+
// Seeds challenges (with prerequisites), sets branding (title/logo/favicon),
// keeps challenges hidden unless logged in, is idempotent via CTFd config,
// and proactively verifies DB connectivity (works for Neon) before seeding.

import fs from "fs/promises";

const BASE = process.env.CTFD_URL || "http://127.0.0.1:8000";
const SEED_FILE = "/app/ctfd-seed.json";

// ---- helpers ----
async function readToken() {
  const candidates = ["/tmp/ctfd_token", "/data/ctfd_token"];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const t = raw.trim();
      if (t) return t;
    } catch { /* try next */ }
  }
  throw new Error("No admin API token found. Expected /tmp/ctfd_token or /data/ctfd_token.");
}

async function readSeed() {
  const raw = await fs.readFile(SEED_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.challenges || [];
}

// Single-read fetch wrapper (avoids "Body is unusable")
async function api(endpoint, { method = "GET", token, body, headers } = {}) {
  const res = await fetch(`${BASE}/api/v1/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Token ${token}`,
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* ignore non-JSON */ }

  if (!res.ok) {
    const snippet = raw?.slice(0, 500);
    throw new Error(`${method} /api/v1/${endpoint} -> ${res.status}${data ? ` ${JSON.stringify(data)}` : snippet ? ` ${snippet}` : ""}`);
  }
  return data ?? { ok: true, raw };
}

// ---- config helpers ----
async function getConfig(token, key) {
  try {
    const got = await api(`configs?key=${encodeURIComponent(key)}`, { token });
    return got?.data?.value ?? null;
  } catch {
    try {
      const got = await api(`config?key=${encodeURIComponent(key)}`, { token });
      return got?.data?.value ?? null;
    } catch { return null; }
  }
}

async function setConfigKey(token, key, value) {
  try {
    await api(`configs/${encodeURIComponent(key)}`, { method: "PATCH", token, body: { value } });
    return;
  } catch {
    await api("config", { method: "PATCH", token, body: { key, value } });
  }
}

async function setConfig(token, kv) {
  try {
    for (const [key, value] of Object.entries(kv)) {
      console.log(`[config] (per-key) ${key} = ${value}`);
      await api(`configs/${encodeURIComponent(key)}`, { method: "PATCH", token, body: { value } });
    }
    return;
  } catch (e1) {
    console.warn("[config] per-key PATCH failed, trying batch /configs …", e1.message);
  }
  try {
    console.log("[config] (batch) applying all keys via /configs");
    await api("configs", { method: "PATCH", token, body: kv });
    return;
  } catch (e2) {
    console.warn("[config] batch PATCH failed, trying legacy /config …", e2.message);
  }
  for (const [key, value] of Object.entries(kv)) {
    console.log(`[config] (legacy) ${key} = ${value}`);
    await api("config", { method: "PATCH", token, body: { key, value } });
  }
}

// ---- DB connectivity probe (ensures Neon URL is valid & writable) ----
async function verifyDb(token) {
  const key = "cal_sal_db_probe";
  const stamp = `probe-${Date.now()}`;
  console.log("[probe] verifying DB connectivity via config round-trip…");
  await setConfigKey(token, key, stamp);
  const back = await getConfig(token, key);
  if (back !== stamp) {
    throw new Error(`[probe] DB/config round-trip failed (wrote "${stamp}", read "${back}"). Check DATABASE_URL, SSL mode, and CTFd logs.`);
  }
  // optional: clear the probe key
  try { await setConfigKey(token, key, ""); } catch { /* ignore */ }
  console.log("[probe] DB connectivity OK ✅");
}

// ---- main seeding ----
async function seed() {
  const token = await readToken();

  // Ensure CTFd is responding AND the DB is writable (Neon)
  await verifyDb(token);

  // Idempotency without a disk: use a CTFd config flag
  const already = await getConfig(token, "cal_sal_seeded");
  if (already === "true") {
    console.log("Seed skipped: cal_sal_seeded=true");
    return;
  }

  // 1) Visibility + branding (logo/favicon baked into theme at build)
  await setConfig(token, {
    ctf_active: true,
    registration_visibility: "public",
    challenge_visibility: "private", // hide unless logged in
    score_visibility: "private",     // hide scoreboard unless logged in
    ctf_name: "Cal Sal CTF",
    ctf_logo: "/themes/core/static/img/bg.gif",
    ctf_favicon: "/themes/core/static/img/favicon.ico",
  });

  // 2) Create challenges and flags
  const items = await readSeed();
  const nameToId = new Map();

  for (const c of items) {
    const payload = {
      name: c.name,
      category: c.category ?? "White Rabbit",
      description: c.description ?? "",
      value: c.value ?? 100,
      type: c.type ?? "standard",
      state: c.state ?? "visible",
    };
    const created = await api("challenges", { method: "POST", token, body: payload });
    const cid = created?.data?.id;
    if (!cid) throw new Error(`Failed to create challenge: ${c.name}`);
    nameToId.set(c.name, cid);
    console.log(`[challenge] created "${c.name}" -> id ${cid}`);

    if (Array.isArray(c.flags)) {
      for (const f of c.flags) {
        await api("flags", {
          method: "POST",
          token,
          body: { challenge_id: cid, type: f.type ?? "static", content: f.content },
        });
        console.log(`  [flag] + ${f.content}`);
      }
    }
  }

  // 3) Apply prerequisites
  for (const c of items) {
    if (!c.requires) continue;
    const thisId = nameToId.get(c.name);
    const prevId = nameToId.get(c.requires);
    if (!thisId || !prevId) {
      console.warn(`[requires] skipping "${c.name}" -> "${c.requires}" (id missing)`);
      continue;
    }
    await api(`challenges/${thisId}`, {
      method: "PATCH",
      token,
      body: { requirements: { prerequisites: [prevId] } },
    });
    console.log(`[requires] "${c.name}" now requires "${c.requires}" (${prevId})`);
  }

  // Mark as seeded so future boots skip seeding
  await setConfigKey(token, "cal_sal_seeded", "true");
  console.log("Seeding + branding complete ✅ (flag set: cal_sal_seeded=true)");
}

seed().catch((e) => {
  console.error("Seeder failed:", e);
  process.exit(1);
});
