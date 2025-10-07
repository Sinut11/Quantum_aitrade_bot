const express = require("express");
const router = express.Router();
const User = require("../models/User");

// POST /api/bind-referral  { code: "<referralCode>" }
router.post("/bind-referral", async (req, res) => {
  try {
    const { tgId } = req.tg || {};
    const code = String(req.body?.code || "").trim();

    if (!tgId) return res.json({ ok: false, error: "no_tg" });
    if (!code) return res.json({ ok: false, error: "no_code" });

    const user = await User.findOne({ tgId });
    if (!user) return res.json({ ok: false, error: "no_user" });

    if (user.referredByUserId) {
      return res.json({ ok: true, already: true }); // already bound once
    }

    const inviter = await User.findOne({ referralCode: code });
    if (!inviter) return res.json({ ok: false, error: "bad_code" });
    if (String(inviter.tgId) === String(tgId)) {
      return res.json({ ok: false, error: "self_ref" });
    }

    user.referredByUserId = inviter._id;
    user.stats = { ...(user.stats || {}), updatedAt: new Date() };
    await user.save();

    return res.json({ ok: true, bound: true });
  } catch (err) {
    console.error("bind-referral error", err);
    return res.json({ ok: false, error: "bind_error" });
  }
});

module.exports = router;
