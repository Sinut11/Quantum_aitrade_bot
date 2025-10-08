// routes/debug.js
const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Deposit = require('../models/Deposit');

// ---- Admin auth (works in any env) ----
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ALLOW_DEBUG = String(process.env.ALLOW_DEBUG || '').toLowerCase() === 'true';

function isAuthed(req) {
  if (ALLOW_DEBUG) return true;
  const key = req.get('X-Admin-Key') || req.get('x-admin-key') || '';
  return ADMIN_KEY && key === ADMIN_KEY;
}

// Quick sanity check so you know which code is live
router.get('/ping', (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'unknown',
    allowDebug: ALLOW_DEBUG,
    hasAdminKey: !!ADMIN_KEY,
    note: 'If you see this, the new debug.js is deployed.'
  });
});

// POST /api/debug/simulate-deposit
// body: { tgId: "3001", amount: 60, txid?: "dev-3001-seed" }
router.post('/simulate-deposit', async (req, res) => {
  try {
    if (!isAuthed(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const { tgId, amount, txid } = req.body || {};
    if (!tgId) return res.status(400).json({ ok: false, error: 'tgId_required' });

    const amt = Number(amount);
    if (!(typeof amt === 'number' && isFinite(amt) && amt > 0)) {
      return res.status(400).json({ ok: false, error: 'amount_invalid' });
    }

    const safeTxid = txid || `devtx-${tgId}-${Date.now()}`;

    // Idempotent by txid
    let dep = await Deposit.findOne({ txid: safeTxid });
    if (!dep) {
      dep = await Deposit.create({
        tgId,
        amount: amt,
        creditedQP: amt,
        txid: safeTxid,
        status: 'confirmed',
        source: 'debug'
      });
    }

    const user = await (await User).findOne({ tgId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });

    user.balances = user.balances || {};
    user.balances.qp = Number(user.balances.qp || 0) + dep.creditedQP;
    await user.save();

    res.json({
      ok: true,
      credited: dep.creditedQP,
      qpBalance: user.balances.qp,
      txid: dep.txid,
      status: dep.status
    });
  } catch (e) {
    // Duplicate txid? Treat as success.
    if (e && e.code === 11000 && req.body?.txid) {
      const dep = await Deposit.findOne({ txid: req.body.txid });
      return res.json({
        ok: true,
        credited: dep?.creditedQP || 0,
        txid: req.body.txid,
        status: dep?.status || 'confirmed'
      });
    }
    console.error('simulate-deposit error', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
