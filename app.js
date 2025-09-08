// app.js (ESM)
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Nginx proxy
app.set("trust proxy", true);

// Tiny request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`[node] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions
app.use(
  session({
    secret: "secure-session-key",
    resave: false,
    saveUninitialized: true,
  })
);

// Root -> index.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Static assets from /public
app.use(express.static(path.join(__dirname, "public")));

// Validate secret sequence (sets session gate)
app.post("/validate-sequence", (req, res) => {
  const validSequences = ["followthewhiterabbit", "follow the white rabbit"];
  const { sequence } = req.body;

  console.log("[node] sequence submitted:", sequence);

  if (validSequences.includes(sequence)) {
    req.session.passkeyAccess = true;
    console.log("[node] sequence validated: access granted");
    return res.json({ valid: true });
  }
  console.log("[node] invalid sequence");
  return res.json({ valid: false });
});

// Validate passkey (requires prior session gate)
app.post("/validate-passkey", (req, res) => {
  if (!req.session.passkeyAccess) {
    return res.redirect("/index.html?error=1");
  }

  const validPasskeys = ["first step", "firststep"];
  const { passkey } = req.body;

  if (validPasskeys.includes(passkey)) {
    return res.redirect("/meta-thinking.html");
  }
  return res.redirect("/index.html?error=1");
});

// 404 + error handlers
app.use((req, res) => {
  console.log(`[node] 404 ${req.method} ${req.originalUrl}`);
  res.status(404).send("Not Found");
});

app.use((err, _req, res, _next) => {
  console.error("[node] Unhandled error:", err);
  res.status(500).send("Internal Server Error");
});

// Start
app.listen(PORT, "0.0.0.0", () => console.log(`listening ${PORT}`));
