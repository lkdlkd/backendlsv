const mongoose = require('mongoose');

const telegramSchema = new mongoose.Schema({
  botToken: { type: String, default: "" },
  chatId: { type: String, default: "" },
  bot_notify: { type: String, default: "7373571777:AAHJL0Y4I719aWxOecbWiS561x8J6wjKmbI" },
}, { timestamps: true });

module.exports = mongoose.model('Telegram', telegramSchema);