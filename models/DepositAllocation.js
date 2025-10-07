// server/models/DepositAllocation.js
const mongoose = require('mongoose');

const DepositAllocationSchema = new mongoose.Schema({
  tgId: { type: String, required: true, index: true, unique: true },
  derivationIndex: { type: Number, required: true, unique: true, index: true },
  address: { type: String, required: true, index: true },
}, { timestamps: true });

module.exports =
  mongoose.models.DepositAllocation ||
  mongoose.model('DepositAllocation', DepositAllocationSchema);
