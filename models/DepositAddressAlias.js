// server/models/DepositAddressAlias.js
const mongoose = require('mongoose');

const DepositAddressAliasSchema = new mongoose.Schema(
  {
    tgId: { type: String, required: true, unique: true, index: true },
    address: { type: String, required: true, index: true },
    derivationIndex: { type: Number, required: true },
    mode: { type: String, default: 'hd' },
  },
  { timestamps: true, collection: 'depositaddressaliases' }
);

module.exports = mongoose.model('DepositAddressAlias', DepositAddressAliasSchema);
