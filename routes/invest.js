// server/routes/invest.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const telegramAuth = require("../middleware/telegramAuth");

// ---- tier + math ------------------------------------------------------------
const DAYS = 20;
function dailyRateFor(amount) {
  const v = Number(amount || 0);
  if (v > 5000) return 0.018;
  if (v > 1000) return 0.015;
  if (v > 250)  return 0.013;
  if (v > 100)  return 0.012;
  if (v > 0)    return 0.011; // < $100
  return 0;
}

function quote(amount) {
  const a = Number(amount || 0);
  const r = dailyRateFor(a);
  const daily = a * r;
  const total = a * (1 + r * DAYS);
  return { amount: a, rate: r, days: DAYS, daily, total };
}

// ---- public helpers ---------------------------------------------------------
router.get("/tiers", (_req, res) => {
  res.json({
    ok: true,
    days: DAYS,
    tiers: [
      { gt: 0,     lte: 100,  rate: 0.011 },
      { gt: 100,   lte: 250,  rate: 0.012 },
      { gt: 250,   lte: 1000, rate: 0.013 },
      { gt: 1000,  lte: 5000, rate: 0.015 },
      { gt: 5000,  lte: null, rate: 0.018 },
    ],
  });
});

router.post("/quote", express.json(), (req, res) => {
  const { amount } = req.body || {};
  const q = quote(amount);
  res.json({ ok: true, ...q });
});

// ---- buy from balance -------------------------------------------------------
router.post("/buy", telegramAuth, express.json(), async (req, res) => {
  try {
    const tgId = req.tgId;
    if (!tgId) return res.status(400).json({ ok: false, error: "no_tg" });

    const { amount } = req.body || {};
    const a = Number(amount || 0);
    if (!Number.isFinite(a) || a < 10) {
      return res.status(400).json({ ok: false, error: "min_10" });
    }

    const session = await mongoose.startSession();
    let out;
    await session.withTransaction(async () => {
      const user = await User.findOne({ tgId: String(tgId) }).session(session);
      if (!user) throw Object.assign(new Error("no_user"), { code: "no_user" });

      const bal = Number(user.balances?.withdrawable || 0);
      if (a > bal) throw Object.assign(new Error("insufficient"), { code: "insufficient" });

      const r = dailyRateFor(a);
      if (r <= 0) throw Object.assign(new Error("bad_amount"), { code: "bad_amount" });

      // deduct from balance
      user.balances = user.balances || {};
      user.balances.withdrawable = Number((bal - a).toFixed(2));

      // create plan (20 days)
      const now = new Date();
      const end = new Date(now.getTime() + DAYS * 24 * 60 * 60 * 1000);
      user.activePlans = Array.isArray(user.activePlans) ? user.activePlans : [];
      user.activePlans.push({
        principal: a,
        dailyRate: r,
        days: DAYS,
        startAt: now,
        endAt: end,
        status: "active",
      });

      // (optional) lock QP representing principal
      const qp = Number(user.balances.lockedQP || 0);
      user.balances.lockedQP = Number((qp + a).toFixed(2));

      await user.save({ session });

      out = {
        ok: true,
        balances: user.balances,
        activePlans: user.activePlans,
        quote: quote(a),
      };
    });
    session.endSession();
    return res.json(out);
  } catch (e) {
    const code = e.code || "error";
    if (code === "insufficient") return res.status(400).json({ ok: false, error: "insufficient_balance" });
    if (code === "no_user") return res.status(404).json({ ok: false, error: "no_user" });
    return res.status(500).json({ ok: false, error: "buy_failed" });
  }
});

module.exports = router;
