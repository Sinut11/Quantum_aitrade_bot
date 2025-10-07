// server/routes/demoTrades.js
const express = require("express");
const router = express.Router();

const SYMBOLS = ["BTC/USDT", "ETH/USDT", "BNB/USDT", "XRP/USDT", "SOL/USDT", "ADA/USDT", "DOGE/USDT"];
const ACTIONS = ["BUY", "SELL"];

function rnd(min, max, d = 2) {
  return Number((Math.random() * (max - min) + min).toFixed(d));
}

function buildRow(i) {
  const now = Date.now() - i * 5 * 60 * 1000; // every 5 mins
  const ts = new Date(now).toISOString();
  const sym = SYMBOLS[i % SYMBOLS.length];
  const side = ACTIONS[i % 2];
  const price = rnd(0.1, 60000, 2);
  const pnl = rnd(-3, 3, 2);
  return { t: ts, sym, side, price, pnl };
}

router.get("/", (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
  const items = Array.from({ length: limit }, (_, i) => buildRow(i));
  res.json({ ok: true, items });
});

module.exports = router;
