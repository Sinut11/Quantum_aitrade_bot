// server/routes/withdraw.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');                // your existing User model
const Withdrawal = require('../models/Withdrawal');    // new
const { sendUsdt } = require('../services/chain');

const MIN_WITHDRAW = 10; // USDT

// Basic BEP-20 / EVM address check
function isAddress(a){
  return /^0x[a-fA-F0-9]{40}$/.test(String(a||''));
}

// GET: my withdraw info
router.get('/me', async (req, res) => {
  try {
    const tgId = req.tgId || (req.tg?.tgId);
    if (!tgId) return res.json({ ok: false, error: 'no_tgid' });

    const u = await User.findOne({ tgId }).lean();
    if (!u) return res.json({ ok: false, error: 'user_not_found' });

    const withdrawable = Number(u.balances?.withdrawable || 0);
    const payoutAddress = u.payout?.address || "";

    return res.json({ ok: true, withdrawable, payoutAddress, min: MIN_WITHDRAW });
  } catch (e) {
    console.error('withdraw.me error', e);
    return res.json({ ok: false, error: 'server_error' });
  }
});

// POST: set / update payout address
router.post('/address', async (req, res) => {
  try {
    const tgId = req.tgId || (req.tg?.tgId);
    if (!tgId) return res.json({ ok: false, error: 'no_tgid' });

    const address = String(req.body?.address || '').trim();
    if (!isAddress(address)) return res.json({ ok: false, error: 'bad_address' });

    const u = await User.findOneAndUpdate(
      { tgId },
      { $set: { 'payout.address': address } },
      { new: true, upsert: false }
    ).lean();

    if (!u) return res.json({ ok: false, error: 'user_not_found' });
    return res.json({ ok: true, address });
  } catch (e) {
    console.error('withdraw.address error', e);
    return res.json({ ok: false, error: 'server_error' });
  }
});

// POST: request withdraw -> deduct balance, queue, send, finalize (safe 2-phase)
router.post('/request', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const tgId = req.tgId || (req.tg?.tgId);
    if (!tgId) return res.json({ ok: false, error: 'no_tgid' });

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
      return res.json({ ok: false, error: 'min_10' });
    }

    // Phase 1: reserve & queue
    let queued;
    await session.withTransaction(async () => {
      const u = await User.findOne({ tgId }).session(session).lean(false);
      if (!u) throw new Error('user_not_found');

      const payout = u.payout?.address || '';
      if (!isAddress(payout)) {
        const err = new Error('no_payout_address');
        err.code = 'no_payout_address';
        throw err;
      }

      const avail = Number(u.balances?.withdrawable || 0);
      if (avail < amount) {
        const err = new Error('insufficient_balance');
        err.code = 'insufficient_balance';
        throw err;
      }

      // deduct immediately (reserve)
      u.balances.withdrawable = +(avail - amount).toFixed(6);
      await u.save({ session });

      // create queue doc
      queued = await Withdrawal.create([{
        tgId,
        amount,
        to: payout,
        status: 'queued'
      }], { session });

      queued = queued[0];
    });

    // Phase 2: send on-chain (no DB session while broadcasting)
    let txHash = '';
    try {
      const tx = await sendUsdt(queued.to, queued.amount);
      txHash = tx.hash;
    } catch (chainErr) {
      // Phase 3(a): refund & mark failed
      await session.withTransaction(async () => {
        const u = await User.findOne({ tgId }).session(session).lean(false);
        const cur = Number(u.balances?.withdrawable || 0);
        u.balances.withdrawable = +(cur + queued.amount).toFixed(6);
        await u.save({ session });

        await Withdrawal.updateOne(
          { _id: queued._id },
          { $set: { status: 'failed', failReason: String(chainErr?.message || 'chain_error') } },
          { session }
        );
      });

      return res.json({ ok: false, error: 'chain_send_failed' });
    }

    // Phase 3(b): mark sent with hash
    await Withdrawal.updateOne(
      { _id: queued._id },
      { $set: { status: 'sent', txHash } }
    );

    return res.json({ ok: true, txHash });
  } catch (e) {
    console.error('withdraw.request error', e);

    // normalized errors
    if (e?.code === 'no_payout_address') return res.json({ ok: false, error: 'no_payout_address' });
    if (e?.message === 'user_not_found') return res.json({ ok: false, error: 'user_not_found' });
    if (e?.code === 'insufficient_balance') return res.json({ ok: false, error: 'insufficient_balance' });

    return res.json({ ok: false, error: 'server_error' });
  } finally {
    session.endSession();
  }
});

module.exports = router;
