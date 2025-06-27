const mongoose = require('mongoose');

const BankSchema = new mongoose.Schema({
    bank_name: { type: String, required: true },
    account_name: { type: String, required: true },
    account_number: { type: String, required: true },
    logo: { type: String },
    bank_account: { type: String, required: true },
    bank_password: { type: String, required: true },
    min_recharge: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
    token: { type: String },
    domain: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Bank', BankSchema);