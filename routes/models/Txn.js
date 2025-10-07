const mongoose = require("mongoose");
const TxnSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  type: { type: String, index: true },
  token: { type: String, default: "USDT" },
  amount: { type: Number, default: 0 },
  status: { type: String, default: "ok" },
  level: { type: Number, default: 0 },
  meta: { type: Object, default: {} },
  txHash: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: false });
module.exports = mongoose.models.Txn || mongoose.model("Txn", TxnSchema, "txns");
