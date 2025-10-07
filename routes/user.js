// server/routes/user.js
const express = require('express');
const router = express.Router();

const User = require('../models/User');
const { ensureUser, attachReferralIfMissing } = require('../services/referralLinker');

router.get('/me', async (req, res) => {
  try {
    const tgId = String(req.tgId || '');
    if (!tgId) return res.json({ ok: false, error: 'no_tg' });

    // ensure user exists & has own code
    const me = await ensureUser({ tgId, username: req.tg?.username || '' });

    // fallback referral attach if a code is present in query and not set yet
    if (req.refCode) {
      await attachReferralIfMissing({ tgId, referralCode: req.refCode });
      await me.reload();
    }

    // compute totals (UI expects these names)
    const totalEarned = Number(me.balances?.referralEarned || 0) + Number(me.balances?.packageEarned || 0);

    // minimal activePlans stub if you don’t track them elsewhere
    const activePlans = me.activePlans || [];

    res.json({
      ok: true,
      balances: {
        qp: Number(me.balances?.qp || 0),
        lockedQP: Number(me.balances?.lockedQP || 0),
        referralEarned: Number(me.balances?.referralEarned || 0),
        packageEarned: Number(me.balances?.packageEarned || 0)
      },
      totalEarned,
      referralCode: me.balances?.referralCode,
      botUsername: process.env.BOT_USERNAME,
      payoutAddress: me.payoutAddress || '',
      activePlans
    });
  } catch (e) {
    console.error('/api/me error', e);
    res.json({ ok: false, error: 'me_failed' });
  }
});

module.exports = router;
