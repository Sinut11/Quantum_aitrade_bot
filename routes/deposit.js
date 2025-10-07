// server/routes/deposit.js
const express = require('express');
const router = express.Router();

const addressAllocator = require('../services/addressAllocator');

/**
 * GET /api/deposit-address?tgId=123
 * Returns a per-user deposit address. Works in browser (query) or in mini app.
 */
router.get('/deposit-address', async (req, res) => {
  try {
    // Accept tgId from middleware (if you add it) or from the query string
    const tgId =
      (req.tg && req.tg.tgId) ||
      req.tgId ||
      (req.query && String(req.query.tgId || '').trim());

    if (!tgId) {
      return res.status(400).json({ ok: false, error: 'no_tgId' });
    }

    const r = await addressAllocator.getOrCreateDepositAddress(tgId);

    // r has { address, derivationIndex, mode }
    return res.json({
      ok: true,
      address: r.address,
      mode: r.mode,
      idx: r.derivationIndex,
    });
  } catch (e) {
    console.error('deposit-address error:', e);
    return res.json({
      ok: false,
      error: e.explain || e.code || e.message || 'server_error',
    });
  }
});

module.exports = router;
