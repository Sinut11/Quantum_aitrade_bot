// server/routes/depositsWebhook.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const SysState = require("../models/SysState");
const User = require("../models/User");

const AUTH = process.env.WEBHOOK_SECRET || "";

router.post("/credit-deposit", express.json(), async (req, res) => {
  try {
    if (!AUTH || req.get("x-auth") !== AUTH) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const { tgId, amount, txHash, chain, toAddress } = req.body || {};
    const a = Number(amount || 0);
    if (!tgId || !txHash || !Number.isFinite(a) || a <= 0) {
      return res.status(400).json({ ok: false, error: "bad_body" });
    }

    const key = `dep:${txHash}`;
    const session = await mongoose.startSession();
    let out;

    await session.withTransaction(async () => {
      // idempotency: upsert SysState key if not exists
      const prev = await SysState.findOne({ key }).session(session);
      if (prev) {
        out = { ok: true, status: "duplicate", credited: false };
        return;
      }

      const user = await User.findOne({ tgId: String(tgId) }).session(session);
      if (!user) throw Object.assign(new Error("no_user"), { code: "no_user" });

      user.balances = user.balances || {};
      const bal = Number(user.balances.withdrawable || 0);
      user.balances.withdrawable = Number((bal + a).toFixed(2));

      await user.save({ session });
      await SysState.create([{ key, value: { tgId, a, txHash, chain, toAddress } }], { session });

      out = { ok: true, status: "credited", balances: user.balances };
    });

    session.endSession();
    return res.json(out);
  } catch (e) {
    if (e.code === "no_user") return res.status(404).json({ ok: false, error: "no_user" });
    return res.status(500).json({ ok: false, error: "credit_failed" });
  }
});

module.exports = router;
