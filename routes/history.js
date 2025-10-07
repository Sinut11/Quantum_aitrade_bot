// server/routes/history.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Define a tiny, private schema for listing transactions *without* overwriting on hot reloads.
const TxnSchema = new mongoose.Schema(
  {
    tgId:   { type: String, index: true },
    type:   { type: String, default: 'txn' },   // deposit | withdraw | invest | reward | etc.
    amount: { type: Number, default: 0 },
    status: { type: String, default: 'ok' },
  },
  { timestamps: true, collection: 'txns' } // read from 'txns' collection if you already use it
);

// <-- THE IMPORTANT LINE: never recompile the same model name -->
const Txn = mongoose.models.Txn_stub || mongoose.model('Txn_stub', TxnSchema);

// GET /api/txns?limit=25&tgId=123
router.get('/txns', async (req, res) => {
  try {
    const tgId = String(req.query.tgId || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);

    if (!tgId) return res.json({ ok: true, items: [] });

    const items = await Txn.find({ tgId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
