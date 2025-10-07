// server/routes/referrals.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

const MAX_LEVELS = 15;

function extractTgId(req) {
  const raw =
    req.get('X-Telegram-Init') ||
    req.get('x-telegram-init') ||
    req.get('X-Telegram-Init-Data') ||
    req.get('x-telegram-init-data') ||
    '';
  try {
    if (raw) {
      const qs = new URLSearchParams(raw);
      const uj = qs.get('user');
      if (uj) {
        const u = JSON.parse(uj);
        if (u && u.id) return String(u.id);
      }
    }
  } catch {}
  if (req.get('X-TG-ID')) return String(req.get('X-TG-ID'));
  const q = req.query.tgId || req.query.userId || '';
  return q ? String(q) : null;
}

/**
 * earnings[level] = 1% * sum( all QP purchases (plans) by users at that level )
 * We sum qp from every plan in each downline user's activePlans (active + completed).
 */
router.get('/referrals', async (req, res) => {
  try {
    const tgId = extractTgId(req);
    if (!tgId) return res.status(400).json({ ok:false, error:'no_tgId' });

    const me = await User.findOne({ tgId }).select('tgId').lean();
    if (!me) {
      const zeros = Array.from({ length: MAX_LEVELS }, (_, i) => ({ level: i+1, count: 0, earnings: 0 }));
      return res.json({ ok:true, summary: zeros, source: 'no-user' });
    }

    let frontier = [me.tgId];
    const summary = [];

    for (let level = 1; level <= MAX_LEVELS; level++) {
      if (!frontier.length) {
        summary.push({ level, count: 0, earnings: 0 });
        continue;
      }

      // users at this level + their plans to sum QP
      const down = await User.find({ referredBy: { $in: frontier } })
        .select('tgId activePlans')
        .lean();

      const count = down.length;
      let qpSum = 0;
      for (const u of down) {
        const plans = Array.isArray(u.activePlans) ? u.activePlans : [];
        for (const p of plans) {
          const q = Number(p?.qp || 0);
          if (q > 0) qpSum += q;
        }
      }
      const earnings = qpSum * 0.01; // 1% per level

      summary.push({ level, count, earnings });
      frontier = down.map(d => d.tgId);
    }

    return res.json({ ok:true, summary, source:'db' });
  } catch (e) {
    console.error('GET /api/referrals error:', e);
    const zeros = Array.from({ length: MAX_LEVELS }, (_, i) => ({ level: i+1, count: 0, earnings: 0 }));
    return res.json({ ok:true, summary: zeros, source:'error-fallback' });
  }
});

module.exports = router;
