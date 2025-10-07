// server/routes/referrals.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

let User, Txn;
try { User = require("../models/User"); }
catch {
  User = mongoose.model("User_stub", new mongoose.Schema({ tgId: String }, { collection: "users" }));
}
try { Txn = require("../models/Txn"); }
catch {
  Txn = mongoose.model("Txn_stub", new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    type: String,
    amount: Number,
    meta: Object,
    createdAt: { type: Date, default: Date.now }
  }, { collection: "txns" }));
}

// ---------- NEW: same extractor used in /api/me ----------
function extractTelegramFromReq(req) {
  const initRaw = req.get("X-Telegram-Init") || req.query.init || "";
  let id = req.tgId || req.tg?.id || "";
  if (!id && initRaw) {
    try {
      const params = new URLSearchParams(initRaw);
      const userJson = params.get("user");
      if (userJson) {
        const u = JSON.parse(userJson);
        id = u?.id ? String(u.id) : "";
      }
    } catch {}
  }
  return String(id || "").trim();
}

/**
 * GET /api/referrals
 * Returns: { ok:true, levels:[{level, users, earned}], totalUsers, totalEarned }
 */
router.get("/", async (req, res) => {
  try {
    const tgId = extractTelegramFromReq(req);
    if (!tgId) return res.status(401).json({ ok:false, error:"unauthorized" });

    const me = await User.findOne({ tgId }, { _id:1 }).lean();
    if (!me?._id) {
      return res.json({
        ok:true,
        levels: Array.from({length:15},(_,i)=>({level:i+1,users:0,earned:0})),
        totalUsers: 0,
        totalEarned: 0
      });
    }

    const agg = await Txn.aggregate([
      { $match: { userId: me._id, type: "referral" } },
      { $group: {
          _id: { lvl: { $ifNull: ["$meta.level", 0] }, ref: "$meta.refereeId" },
          amt: { $sum: "$amount" }
        }
      },
      { $group: { _id: "$_id.lvl", users: { $sum: 1 }, earned: { $sum: "$amt" } } },
      { $project: { _id:0, level:"$_id", users:1, earned:1 } }
    ]);

    const byLevel = new Map(agg.map(r => [Number(r.level || 0), {
      level: Number(r.level || 0),
      users: Number(r.users || 0),
      earned: Number(r.earned || 0)
    }]));

    const levels = [];
    let totalUsers = 0, totalEarned = 0;
    for (let i = 1; i <= 15; i++) {
      const row = byLevel.get(i) || { level: i, users: 0, earned: 0 };
      totalUsers += row.users;
      totalEarned += row.earned;
      levels.push(row);
    }

    res.json({ ok:true, levels, totalUsers, totalEarned });
  } catch (e) {
    console.error("referrals route error:", e?.message || e);
    res.json({
      ok:true,
      levels: Array.from({length:15},(_,i)=>({level:i+1,users:0,earned:0})),
      totalUsers: 0,
      totalEarned: 0
    });
  }
});

module.exports = router;
