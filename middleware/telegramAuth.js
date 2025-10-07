// server/middleware/telegramAuth.js
function parseInitData(raw) {
  if (!raw) return {};
  try {
    // header value may be URI-encoded JSON (from your previous file)
    const u = decodeURIComponent(raw);
    const j = JSON.parse(u);
    return {
      tgId: j?.user?.id ? String(j.user.id) : '',
      username: j?.user?.username || '',
      first_name: j?.user?.first_name || '',
      last_name: j?.user?.last_name || ''
    };
  } catch {
    return {};
  }
}

module.exports = function telegramAuth(req, _res, next) {
  const hA = req.header('x-telegram-init');
  const hB = req.header('x-telegram-web-app-data'); // some clients
  let ctx = parseInitData(hA) || {};
  if (!ctx.tgId) ctx = parseInitData(hB) || {};

  // Fallback to query (?tgId= & ?username=)
  if (!ctx.tgId && req.query.tgId) {
    ctx.tgId = String(req.query.tgId);
    if (req.query.username) ctx.username = String(req.query.username);
  }

  // Referral code from query (?rc= or ?start=)
  let refCode = '';
  if (req.query.rc) refCode = String(req.query.rc);
  if (!refCode && req.query.start) refCode = String(req.query.start);
  req.refCode = refCode || '';

  req.tg = ctx;
  req.tgId = ctx.tgId || '';
  next();
};
