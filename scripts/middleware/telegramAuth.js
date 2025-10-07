// server/middleware/telegramAuth.js
const crypto = require("crypto");
const { URLSearchParams } = require("url");

// Parse Telegram initData from header/query
function parseInitData(init) {
  const params = new URLSearchParams(init || "");
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  try { if (obj.user) obj.user = JSON.parse(obj.user); } catch {}
  return obj;
}

// Verify per Telegram docs (skip if no BOT_TOKEN set)
function verifyInit(init, botToken) {
  if (!botToken) return true;
  const params = new URLSearchParams(init);
  const hash = params.get("hash");
  if (!hash) return false;

  const data = [];
  for (const [k, v] of params) if (k !== "hash") data.push(`${k}=${v}`);
  data.sort();
  const dataCheckString = data.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return calc === hash;
}

// Middleware: attaches req.tg (id/username) and req.userKey (id string)
// Refuses the request if we cannot identify the user.
module.exports = function telegramAuth({ allowDebug = false } = {}) {
  const BOT_TOKEN = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();

  return function (req, res, next) {
    const initRaw = req.get("X-Telegram-Init") || req.query.init || "";
    if (!initRaw) {
      if (allowDebug && req.query.tgId) {
        req.tg = { id: String(req.query.tgId), username: (req.query.username || "").toLowerCase() };
        req.userKey = String(req.query.tgId);
        return next();
      }
      return res.status(401).json({ ok: false, error: "no_init" });
    }

    // Dev path: ?hash=debug
    const params = new URLSearchParams(initRaw);
    if (params.get("hash") === "debug" && allowDebug) {
      const userStr = params.get("user") || "{}";
      let u = {};
      try { u = JSON.parse(userStr); } catch {}
      if (!u.id && req.query.tgId) u.id = req.query.tgId;
      req.tg = {
        id: u?.id ? String(u.id) : "",
        username: (u?.username || "").toLowerCase(),
        first_name: u?.first_name || "",
        last_name: u?.last_name || ""
      };
      if (!req.tg.id) return res.status(401).json({ ok:false, error:"no_id_debug" });
      req.userKey = req.tg.id;
      return next();
    }

    // Normal verification
    if (!verifyInit(initRaw, BOT_TOKEN)) {
      return res.status(401).json({ ok: false, error: "bad_sig" });
    }

    const parsed = parseInitData(initRaw);
    const u = parsed.user || {};
    if (!u.id) return res.status(401).json({ ok:false, error:"no_id" });

    req.tg = {
      id: String(u.id),
      username: (u.username || "").toLowerCase(),
      first_name: u.first_name || "",
      last_name: u.last_name || "",
    };
    req.userKey = req.tg.id;
    next();
  };
};
