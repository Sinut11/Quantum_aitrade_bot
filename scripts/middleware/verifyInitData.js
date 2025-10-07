// server/middleware/verifyInitData.js
const crypto = require("crypto");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const ALLOW_DEBUG_TGID = String(process.env.ALLOW_DEBUG_TGID || "false").toLowerCase() === "true";
const MAX_AGE_SECONDS = 24 * 60 * 60; // accept initData up to 24h old

function parseKV(initData) {
  // "key=value&key=value" -> { key, value }
  const out = {};
  (initData || "").split("&").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    const k = decodeURIComponent(pair.slice(0, idx));
    const v = decodeURIComponent(pair.slice(idx + 1));
    out[k] = v;
  });
  return out;
}

function hmac(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest();
}

function hex(buf) {
  return Buffer.isBuffer(buf) ? buf.toString("hex") : Buffer.from(buf).toString("hex");
}

module.exports = function verifyInitData(req, res, next) {
  try {
    // 1) Read initData from header (preferred)
    const initData = req.get("x-telegram-init") || req.get("X-Telegram-Init") || "";

    // 2) Dev fallback: allow ?tgId=... when ALLOW_DEBUG_TGID=true and no initData
    if (!initData && ALLOW_DEBUG_TGID) {
      const tgId = String(req.query.tgId || req.body?.tgId || "").trim();
      if (tgId) {
        req.tgId = tgId;
        return next();
      }
      return res.status(401).json({ ok: false, error: "missing_initData_or_tgId" });
    }

    if (!initData || !BOT_TOKEN) {
      return res.status(401).json({ ok: false, error: "missing_initData_or_bot_token" });
    }

    // 3) Parse and verify HMAC per Telegram docs
    const kv = parseKV(initData);
    const providedHash = kv.hash;
    if (!providedHash) return res.status(401).json({ ok: false, error: "missing_hash" });

    // Build data_check_string (sorted by key, exclude 'hash')
    const keys = Object.keys(kv).filter(k => k !== "hash").sort();
    const dataCheckString = keys.map(k => `${k}=${kv[k]}`).join("\n");

    // Secret = HMAC_SHA256("WebAppData", bot_token)
    const secret = hmac("WebAppData", BOT_TOKEN);
    const calc = hmac(secret, dataCheckString);
    if (hex(calc) !== providedHash.toLowerCase()) {
      return res.status(401).json({ ok: false, error: "bad_signature" });
    }

    // 4) Age check
    const authDate = Number(kv.auth_date || "0");
    if (!authDate || (Math.floor(Date.now() / 1000) - authDate) > MAX_AGE_SECONDS) {
      return res.status(401).json({ ok: false, error: "stale_auth" });
    }

    // 5) Extract user.tgId
    let tgId = null;
    if (kv.user) {
      try {
        const userObj = JSON.parse(kv.user);
        if (userObj && userObj.id) tgId = String(userObj.id);
      } catch {}
    }
    // Fallback: allow explicit tgId param inside initData (rare)
    if (!tgId && kv.tgId) tgId = String(kv.tgId);

    if (!tgId) {
      return res.status(401).json({ ok: false, error: "no_user_in_initData" });
    }

    req.tgId = tgId;
    next();
  } catch (e) {
    console.error("verifyInitData error:", e?.message || e);
    return res.status(401).json({ ok: false, error: "verify_failed" });
  }
};
