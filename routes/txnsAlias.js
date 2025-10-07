
// server/routes/txnsAlias.js
const express = require("express");
const router = express.Router();

function getTgId(req) {
  return String(req.tgId || req.query.tgId || "").trim();
}

// Try to load a Txn model from common locations
let Txn = null;
try { Txn = require("../Txn"); } catch {}
try { if (!Txn) Txn = require("../models/Txn"); } catch {}
try { if (!Txn) Txn = require("../../models/Txn"); } catch {}

router.get("/", async (req, res) => {
  try {
    const tgId = getTgId(req);
    if (!tgId) return res.status(400).json({ ok: false, error: "no_tgId" });

    // If model not present, return empty list gracefully
    if (!Txn) return res.json({ ok: true, items: [], nextCursor: null });

    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const cursor = req.query.cursor ? { _id: { $lt: req.query.cursor } } : {};
    const q = { tgId, ...cursor };

    const items = await Txn.find(q)
      .sort({ _id: -1 })
      .limit(limit)
      .lean();

    const nextCursor = items.length === limit ? String(items[items.length - 1]._id) : null;
    res.json({ ok: true, items, nextCursor });
  } catch (e) {
    console.error("txnsAlias error:", e?.message || e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
