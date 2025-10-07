// server/routes/devTopup.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

// Minimal User model (works even if you don't already have one imported)
const User =
  mongoose.models.User ||
  mongoose.model(
    "User",
    new mongoose.Schema(
      {
        tgId: { type: String, index: true, unique: true, sparse: true },
        balances: {
          withdrawable: { type: Number, default: 0 },
          lockedQP: { type: Number, default: 0 },
          referralEarned: { type: Number, default: 0 },
        },
        username: String,
        first_name: String,
        last_name: String,
      },
      { timestamps: true }
    )
  );

/**
 * POST /api/dev/topup
 * body: { tgId: "U1", amount: 5 }
 * Adds `amount` USDT to user.balances.withdrawable (dev only).
 */
router.post("/topup", async (req, res) => {
  try {
    const { tgId, amount } = req.body || {};
    const amt = Number(amount);
    if (!tgId || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "bad_args" });
    }

    // upsert user and increment withdrawable
    const user = await User.findOneAndUpdate(
      { tgId: String(tgId) },
      { $inc: { "balances.withdrawable": amt } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({
      ok: true,
      tgId: user.tgId,
      balances: user.balances,
    });
  } catch (e) {
    console.error("dev/topup error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
