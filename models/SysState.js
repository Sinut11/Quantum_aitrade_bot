// server/models/SysState.js
const mongoose = require('mongoose');

const SysStateSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true },
    nextDerivationIndex: { type: Number, default: 0 },
    basePath: { type: String, default: "m/44'/60'/0'/0" },
  },
  { timestamps: true, collection: 'sysstates' }
);

module.exports = mongoose.model('SysState', SysStateSchema);
