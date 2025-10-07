// server/routes/me.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * Extract minimal fields from Telegram init header (no full HMAC verify here, dev-friendly).
 * We only need user.id, user.username, and start_param for attaching referral on first load.
 */
function parseTelegramInit(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const params = new URLSearchParams(raw);
  const userStr = params.get('user');
  let user = null;
  try {
    if (userStr) user = JSON.parse(userStr);
  } catch {}
  const start_param = params.get('start_param') || null;
  return {
    tgId: user && user.id ? String(user.id) : null,
    username: user && user.username ? String(user.username) : null,
    start_param,
  };
}

// Idempotent referral attach (used in /api/me as well)
async function attachInviterIfNeeded(tgId, username, start_param) {
  const now = new Date();
  let inviter = null;

  // Find who invited (by referralCode or tgId)
  if (start_param) {
    inviter = await User.findOne({
      $or: [{ referralCode: start_param }, { tgId: start_param }],
    }).lean();
  }

  // Upsert the user; only set referral fields on first insert
  const upsert = {
    $setOnInsert: { tgId, referralCode: tgId, createdAt: now },
    $set: { username: username || null, updatedAt: now },
  };
  if (inviter && inviter.tgId !== tgId) {
    upsert.$setOnInsert.referredBy = inviter.tgId;
    upsert.$setOnInsert.referredByCode = inviter.referralCode || inviter.tgId;
    upsert.$setOnInsert.referredByUsername = inviter.username || null;
  }

  let me = await User.findOneAndUpdate({ tgId }, upsert, {
    new: true,
    upsert: true,
  });

  // If user already existed without referredBy, set it once
  if (inviter && !me.referredBy && inviter.tgId !== tgId) {
    me.referredBy = inviter.tgId;
    me.referredByCode = inviter.referralCode || inviter.tgId;
    me.referredByUsername = inviter.username || null;
    await me.save();
  }

  return me;
}

/**
 * GET /api/me
 * - Reads Telegram header (X-Telegram-Init) or ?tgId for local browser tests
 * - Ensures the user exists
 * - Attaches inviter (once) if start_param present and user has no referredBy yet
 * - Returns balances and referralCode like your UI expects
 */
router.get('/me', async (req, res) => {
  try {
    const raw = req.header('x-telegram-init') || req.header('X-Telegram-Init');
    const t = parseTelegramInit(raw);

    const tgId = t.tgId || String(req.query.tgId || req.query.userId || '');
    if (!tgId) return res.status(400).json({ ok: false, error: 'missing_tgId' });

    const username = t.username || null;
    const start_param = t.start_param || null;

    const me = await attachInviterIfNeeded(tgId, username, start_param);

    // Shape balances like your front-end expects
    const balances = {
      lockedQP: Number(me.lockedQP || 0),
      withdrawable: Number(me.withdrawable || 0),
      referralEarned: Number(me.referralEarned || 0),
    };

    return res.json({
      ok: true,
      tgId: me.tgId,
      username: me.username || null,
      referralCode: me.referralCode,
      referredBy: me.referredBy || null,
      balances,
      activePlans: me.activePlans || [],
      botUsername: process.env.BOT_USERNAME || 'Quantum_aitrade_bot',
    });
  } catch (e) {
    console.error('/api/me error:', e);
    return res.status(500).json({ ok: false, error: 'me_error' });
  }
});

/**
 * GET /api/referrals?summary=true
 * Returns 15-level summary used by the UI (via $graphLookup).
 */
router.get('/referrals', async (req, res) => {
  try {
    const raw = req.header('x-telegram-init') || req.header('X-Telegram-Init');
    const t = parseTelegramInit(raw);
    const tgId = t.tgId || String(req.query.tgId || '');
    if (!tgId) return res.status(400).json({ ok: false, error: 'missing_tgId' });

    if (String(req.query.summary) !== 'true') {
      // Optional: return direct refs only if you ever need it
      const refs = await User.find({ referredBy: tgId }, { tgId: 1, username: 1, createdAt: 1 }).lean();
      return res.json({ ok: true, items: refs });
    }

    const agg = await User.aggregate([
      { $match: { tgId } },
      {
        $graphLookup: {
          from: 'users',
          startWith: '$tgId',
          connectFromField: 'tgId',
          connectToField: 'referredBy',
          as: 'downline',
          maxDepth: 14, // levels 1..15
          depthField: 'depth',
        },
      },
      { $unwind: '$downline' },
      {
        $group: {
          _id: '$downline.depth',
          count: { $sum: 1 },
          earnings: { $sum: { $ifNull: ['$downline.referralEarned', 0] } },
        },
      },
      {
        $project: {
          level: { $add: ['$_id', 1] }, // 0-based -> 1-based
          count: 1,
          earnings: 1,
          _id: 0,
        },
      },
      { $sort: { level: 1 } },
    ]);

    // Fill up to level 15 with zeros
    const summary = Array.from({ length: 15 }, (_, i) => {
      const row = agg.find((r) => r.level === i + 1);
      return {
        level: i + 1,
        count: row ? row.count : 0,
        earnings: row ? Number(row.earnings || 0) : 0,
      };
    });

    return res.json({ ok: true, summary });
  } catch (e) {
    console.error('/api/referrals error:', e);
    return res.status(500).json({ ok: false, error: 'referrals_error' });
  }
});

module.exports = router;
