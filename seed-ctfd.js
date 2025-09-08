// seed-ctfd.js (ESM) — Node 18+
// Seeds challenges (with prerequisites), sets branding (title/logo/favicon),
// and enables public visibility in CTFd.

import fs from "fs/promises";

const BASE = process.env.CTFD_URL || "http://127.0.0.1:8000";
const TOKEN_PATH = "/data/ctfd_token";
const SEED_FILE = "/app/ctfd-seed.json";

// ---- helpers ----
async function readToken() {
  const raw = await fs.readFile(TOKEN_PATH, "utf-8");
  return raw.trim();
}

async function readSeed() {
  const raw = await fs.readFile(SEED_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  // support either a flat array or {challenges:[...]}
  return Array.isArray(parsed) ? parsed : parsed.challenges || [];
}

// Read response body EXACTLY ONCE to avoid "Body is unusable" errors
async function api(endpoint, { method = "GET", token, body, headers } = {}) {
  const res = await fetch(`${BASE}/api/v1/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      Authorization: `Token ${token}`,
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text(); // single read
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* non-JSON body; keep data = null */
  }

  if (!res.ok) {
    const snippet = raw?.slice(0, 500);
    throw new Error(
      `${method} /api/v1/${endpoint} -> ${res.status}${
        data ? ` ${JSON.stringify(data)}` : snippet ? ` ${snippet}` : ""
      }`
    );
  }

  return data ?? { ok: true, raw };
}

// ---- config: try multiple endpoint styles for compatibility ----
async function setConfig(token, kv) {
  // 1) Preferred modern: PATCH /api/v1/configs/<key>  with { value }
  try {
    for (const [key, value] of Object.entries(kv)) {
      console.log(`[config] (per-key) ${key} = ${value}`);
      await api(`configs/${encodeURIComponent(key)}`, {
        method: "PATCH",
        token,
        body: { value },
      });
    }
    return;
  } catch (e1) {
    console.warn("[config] per-key PATCH failed, trying batch /configs …", e1.message);
  }

  // 2) Batch: PATCH /api/v1/configs  with { key1: val1, key2: val2, ... }
  try {
    console.log("[config] (batch) applying all keys via /configs");
    await api("configs", { method: "PATCH", token, body: kv });
    return;
  } catch (e2) {
    console.warn("[config] batch PATCH failed, trying legacy /config …", e2.message);
  }

  // 3) Legacy: PATCH /api/v1/config  with { key, value } one by one
  for (const [key, value] of Object.entries(kv)) {
    console.log(`[config] (legacy) ${key} = ${value}`);
    await api("config", { method: "PATCH", token, body: { key, value } });
  }
}

// ---- main seeding ----
async function seed() {
  const token = await readToken();
  const items = await readSeed();

  // 1) Visibility + branding
  await setConfig(token, {
    ctf_active: true,
    registration_visibility: "public",  // keep or change as you like
    challenge_visibility: "private",    // <-- hide challenges unless logged in
    score_visibility: "private",         // or "private" if you want the board hidden too
    ctf_name: "Cal Sal CTF",
    ctf_logo: "/public/bg.gif",
    ctf_favicon: "/public/favicon.ico",
  });

  // 2) Create challenges and flags
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
    const created = await api("challenges", {
      method: "POST",
      token,
      body: payload,
    });
    const cid = created?.data?.id;
    if (!cid) throw new Error(`Failed to create challenge: ${c.name}`);
    nameToId.set(c.name, cid);
    console.log(`[challenge] created "${c.name}" -> id ${cid}`);

    if (Array.isArray(c.flags)) {
      for (const f of c.flags) {
        await api("flags", {
          method: "POST",
          token,
          body: {
            challenge_id: cid,
            type: f.type ?? "static",
            content: f.content,
          },
        });
        console.log(`  [flag] + ${f.content}`);
      }
    }
  }

  // 3) Apply prerequisites from "requires" names
  for (const c of items) {
    if (!c.requires) continue;
    const thisId = nameToId.get(c.name);
    const prevId = nameToId.get(c.requires);
    if (!thisId || !prevId) {
      console.warn(
        `[requires] skipping "${c.name}" -> "${c.requires}" (id missing)`
      );
      continue;
    }
    await api(`challenges/${thisId}`, {
      method: "PATCH",
      token,
      body: { requirements: { prerequisites: [prevId] } },
    });
    console.log(
      `[requires] "${c.name}" now requires "${c.requires}" (${prevId})`
    );
  }

  console.log("Seeding + branding complete ✅");
}

seed().catch((e) => {
  console.error("Seeder failed:", e);
  process.exit(1);
});
