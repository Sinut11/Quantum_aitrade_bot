const mongoose = require("mongoose");
const InvestmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  tgId: { type: String, index: true },
  amount: { type: Number, default: 0 },
  plan: { type: Object, default: {} },
  days: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  status: { type: String, default: "active", index: true },
  startAt: { type: Date, default: Date.now },
  endAt: { type: Date },
  nextPayoutAt: { type: Date }
}, { timestamps: true });
module.exports = mongoose.models.Investment || mongoose.model("Investment", InvestmentSchema, "investments");
