// server/routes/qp.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// ---- Models (use your real models if they exist) ----
let User, Investment, Plan, Txn;
try { User = require("../models/User"); }
catch {
  User = mongoose.model(
    "User_stub",
    new mongoose.Schema({ tgId: String, balance: { type: Number, default: 0 } }, { collection: "users" })
  );
}
try { Investment = require("../models/Investment"); }
catch {
  Investment = mongoose.model(
    "Investment_stub",
    new mongoose.Schema(
      {
        userId: mongoose.Schema.Types.ObjectId,
        capital: Number,
        days: Number,
        dailyRate: Number,
        payoutsMade: { type: Number, default: 0 },
        startAt: Date,
        nextPayoutAt: Date,
        endAt: Date,
        status: { type: String, default: "active" },
      },
      { timestamps: true, collection: "investments" }
    )
  );
}
try { Plan = require("../models/Plan"); }
catch {
  Plan = mongoose.model(
    "Plan_stub",
    new mongoose.Schema(
      { code: String, days: Number, dailyRate: Number, min: Number, max: Number, active: Boolean },
      { collection: "plans" }
    )
  );
}
try { Txn = require("../models/Txn"); }
catch {
  Txn = mongoose.model(
    "Txn_stub",
    new mongoose.Schema(
      { userId: mongoose.Schema.Types.ObjectId, type: String, amount: Number, token: String, status: String, meta: Object },
      { collection: "txns" }
    )
  );
}

// ---- helpers ----
async function ensureDefaultPlans() {
  const thirty = await Plan.findOne({ code: "30d" }).lean();
  if (!thirty) {
    await Plan.insertMany([
      { code: "15d", days: 15, dailyRate: 0.010, min: 20, max: 50000, active: true },
      { code: "30d", days: 30, dailyRate: 0.012, min: 20, max: 50000, active: true },
      { code: "45d", days: 45, dailyRate: 0.015, min: 20, max: 50000, active: true },
      { code: "60d", days: 60, dailyRate: 0.018, min: 20, max: 50000, active: true },
    ]);
  }
}
async function get30dPlan() {
  await ensureDefaultPlans();
  return Plan.findOne({ code: "30d", active: true }).lean();
}

/**
 * POST /api/qp/transfer-all
 * Moves ENTIRE withdrawable balance to QP (30 days). Min $20.
 */
router.post("/transfer-all", async (req, res) => {
  try {
    const tgId = String(req.tgId || "");
    if (!tgId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await User.findOne({ tgId });
    if (!me) return res.json({ ok: false, error: "user_not_found" });

    const bal = Number(me.balance || 0);
    if (bal < 20) return res.json({ ok: false, error: "min_20" });

    const plan = await get30dPlan();
    if (!plan) return res.json({ ok: false, error: "plan_missing" });

    const amount = Math.floor(bal * 1e6) / 1e6;
    const now = new Date();
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

    me.balance = bal - amount; // lock into QP
    await me.save();

    await Investment.create({
      userId: me._id,
      capital: amount,
      days: plan.days,
      dailyRate: plan.dailyRate,
      startAt: now,
      nextPayoutAt: next,
      endAt: end,
      payoutsMade: 0,
      status: "active",
    });

    await Txn.create({
      userId: me._id,
      type: "invest",
      token: "USDT",
      amount,
      status: "ok",
      meta: { planCode: "30d", days: plan.days, dailyRate: plan.dailyRate, source: "transfer_all" },
    });

    res.json({ ok: true, amount, plan: { code: "30d", days: plan.days, dailyRate: plan.dailyRate } });
  } catch (e) {
    console.error("qp transfer-all error:", e?.message || e);
    res.json({ ok: false, error: "qp_failed" });
  }
});

/**
 * POST /api/qp/transfer
 * Body: { amount }  (optional; if not supplied, uses full balance)
 * Moves requested amount to QP (30 days). Min $20.
 */
router.post("/transfer", async (req, res) => {
  try {
    const tgId = String(req.tgId || "");
    if (!tgId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await User.findOne({ tgId });
    if (!me) return res.json({ ok: false, error: "user_not_found" });

    const bal = Number(me.balance || 0);
    let amount = Number(req.body?.amount || 0) || bal;
    amount = Math.floor(amount * 1e6) / 1e6;

    if (!(amount > 0)) return res.json({ ok: false, error: "bad_amount" });
    if (amount < 20) return res.json({ ok: false, error: "min_20" });
    if (amount > bal) return res.json({ ok: false, error: "insufficient_balance" });

    const plan = await get30dPlan();
    if (!plan) return res.json({ ok: false, error: "plan_missing" });

    const now = new Date();
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

    me.balance = bal - amount;
    await me.save();

    await Investment.create({
      userId: me._id,
      capital: amount,
      days: plan.days,
      dailyRate: plan.dailyRate,
      startAt: now,
      nextPayoutAt: next,
      endAt: end,
      payoutsMade: 0,
      status: "active",
    });

    await Txn.create({
      userId: me._id,
      type: "invest",
      token: "USDT",
      amount,
      status: "ok",
      meta: { planCode: "30d", days: plan.days, dailyRate: plan.dailyRate, source: "transfer" },
    });

    res.json({ ok: true, amount, plan: { code: "30d", days: plan.days, dailyRate: plan.dailyRate } });
  } catch (e) {
    console.error("qp transfer error:", e?.message || e);
    res.json({ ok: false, error: "qp_failed" });
  }
});

module.exports = router;
