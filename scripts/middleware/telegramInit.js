// server/middleware/telegramInit.js
const crypto = require("crypto");
const { URLSearchParams } = require("url");

function parseInit(initData) {
  const params = new URLSearchParams(initData || "");
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  try { if (obj.user) obj.user = JSON.parse(obj.user); } catch {}
  return obj;
}

function checkHash(initData, botToken) {
  if (!botToken) return true;              // allow in dev if no token set
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;

  const pairs = [];
  for (const [k, v] of params) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return calc === hash;
}

module.exports = function telegramInit() {
  return (req, _res, next) => {
    const initRaw = req.get("X-Telegram-Init") || req.query.init || "";
    if (!initRaw) { req.tg = {}; return next(); }

    if (!checkHash(initRaw, process.env.TELEGRAM_BOT_TOKEN)) {
      req.tg = {}; return next();          // invalid → ignore
    }

    const parsed = parseInit(initRaw);
    const u = parsed.user || {};
    req.tg = {
      id: u?.id ? String(u.id) : "",
      username: (u?.username || "").toLowerCase(),
      first_name: u?.first_name || "",
      last_name: u?.last_name || "",
    };
    next();
  };
};
