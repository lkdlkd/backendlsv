const mongoose = require('mongoose');

const telegramSchema = new mongoose.Schema({
  botToken: { type: String, default: "" },
  chatId: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model('Telegram', telegramSchema);