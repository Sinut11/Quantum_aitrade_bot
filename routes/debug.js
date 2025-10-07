// routes/debug.js
const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Deposit = require('../models/Deposit');

// NOTE: gate this behind auth/ENV in real prod
const DEV_ENABLED = process.env.NODE_ENV !== 'production';

function isPositiveNumber(n) { return typeof n === 'number' && isFinite(n) && n > 0; }

/**
 * POST /api/debug/simulate-deposit
 * body: { tgId: "3001", amount: 50, txid?: "devtx-3001-001" }
 * - Creates a confirmed "Deposit" doc (idempotent by txid).
 * - Credits balances.qp += amount.
 */
router.post('/simulate-deposit', async (req, res) => {
  try {
    if (!DEV_ENABLED) return res.status(403).json({ ok: false, error: 'disabled_in_prod' });

    const { tgId, amount, txid } = req.body || {};
    if (!tgId) return res.status(400).json({ ok: false, error: 'tgId_required' });

    const amt = Number(amount);
    if (!isPositiveNumber(amt)) return res.status(400).json({ ok: false, error: 'amount_invalid' });

    const safeTxid = txid || `devtx-${tgId}-${Date.now()}`;

    // Idempotency: if tx already exists, return it (no double-credit)
    let dep = await Deposit.findOne({ txid: safeTxid });
    if (!dep) {
      dep = await Deposit.create({
        tgId, amount: amt, creditedQP: amt, txid: safeTxid,
        status: 'confirmed', source: 'debug'
      });
    }

    // Credit user QP
    const user = await User.findOne({ tgId });
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
    if (!user.balances) user.balances = {};

    user.balances.qp = Number(user.balances.qp || 0) + dep.creditedQP;
    await user.save();

    return res.json({
      ok: true,
      credited: dep.creditedQP,
      qpBalance: user.balances.qp,
      txid: dep.txid,
      status: dep.status
    });
  } catch (e) {
    if (e && e.code === 11000) {
      // duplicate txid -> treat as success
      const dep = await Deposit.findOne({ txid: req.body.txid });
      return res.json({
        ok: true,
        credited: dep?.creditedQP || 0,
        txid: req.body.txid,
        status: dep?.status || 'confirmed'
      });
    }
    console.error('simulate-deposit error', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
