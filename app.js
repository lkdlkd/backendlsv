require('dotenv').config();
require('module-alias/register');
const express = require('express');
const connectDB = require('@/database/connection');
require('@/controllers/tool/updateServicePrices');
require('@/controllers/tool/checkOrderStatus');
require('@/controllers/tool/RechargeCardController');
require('@/controllers/tool/RestThang');
require('@/controllers/tool/laytrangthaicard');
require('@/controllers/tool/CheckBanKing');
require('@/controllers/tool/Updatetocdo'); // Đảm bảo import Updatetocdo.js để chạy cronjob cập nhật tốc độ dịch vụ
const cors = require('cors');
const api = require('@/routes/api'); // Đường dẫn đúng đến file api.js
const app = express();
const noti = require('@/routes/website/notificationsRouter');
app.use(express.json());
const multer = require('multer');
const upload = multer();
app.use(upload.any());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
const path = require('path');
global.__basedir = path.resolve(__dirname);


// Cấu hình CORS cho các API khác
const corsOptions = {
    origin: process.env.URL_WEBSITE, // Chỉ cho phép domain này
};

// Middleware CORS tùy chỉnh
app.use((req, res, next) => {
    if (req.path.startsWith("/api/v2")) {
        // Không áp dụng CORS cho /api/v2
        next();
    } else {
        cors(corsOptions)(req, res, next);
    }
});
// Kết nối MongoDB
connectDB();
app.get('/', (req, res) => {
    res.send('API is running...');
});
// Sử dụng routes cho API
app.use('/api', api);
app.use('/api/noti', noti);

// ================= Telegram Integration via node-telegram-bot-api =================
const cron = require('node-cron');
const User = require('./models/User');
const Telegram = require('./models/Telegram');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const userController = require('./controllers/user/userControlll');

let bot = null;
let botRetry = 0;
let botRestartTimer = null;
const MAX_RETRY_DELAY = 30000; // 30s

async function scheduleBotRestart(reason) {
    if (botRestartTimer) return; // tránh lên lịch nhiều lần
    const delay = Math.min(MAX_RETRY_DELAY, 1500 * Math.pow(2, botRetry));
    botRetry++;
    console.warn(`[TelegramBot] Sẽ thử khởi động lại sau ${delay}ms. Lý do: ${reason}`);
    botRestartTimer = setTimeout(() => {
        botRestartTimer = null;
        initTelegramBot();
    }, delay);
}

async function initTelegramBot() {
    try {
        const teleConfig = await Telegram.findOne();
        if (!teleConfig || !teleConfig.bot_notify) {
            console.warn('Telegram bot token (bot_notify) chưa cấu hình. Bỏ qua khởi tạo bot.');
            return;
        }
        const token = teleConfig.bot_notify;
        // Nếu đã có bot cũ thì dừng trước
        if (bot) {
            try { await bot.stopPolling(); } catch (_) {}
            bot = null;
        }
        // Xóa webhook để chuyển sang long polling
        try { await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook`); } catch (_) {}
        bot = new TelegramBot(token, { polling: { interval: 1000, autoStart: true, params: { timeout: 50 } } });
        global.bot = bot; // giúp helper sendTelegramMessage dùng lại instance
        botRetry = 0; // reset retry counter khi thành công
        console.log('Telegram bot polling started.');

        bot.on('message', async (msg) => {
            try {
                if (!msg || !msg.chat || !msg.text) return;
                const chatId = msg.chat.id;
                const text = msg.text.trim();
                await userController.processTelegramCommand(chatId, text);
            } catch (err) {
                console.error('Bot message handler error:', err.message);
            }
        });

        bot.on('polling_error', (err) => {
            const code = err.code || '';
            const msg = err.message || '';
            console.error('[TelegramBot] polling_error:', code, msg);
            // ECONNRESET hoặc EFATAL thường do mạng hoặc phiên bị drop => restart
            if (code === 'EFATAL' || msg.includes('ECONNRESET') || msg.includes('ETELEGRAM: 401')) {
                scheduleBotRestart(code || 'polling_error');
            }
        });

        bot.on('error', (err) => {
            console.error('[TelegramBot] error:', err.message);
        });
    } catch (err) {
        console.error('Init Telegram bot error:', err.message);
        scheduleBotRestart('init_failed');
    }
}

initTelegramBot();

// Cron: gửi số dư sau 2 giờ kể từ khi liên kết Telegram (kiểm tra mỗi 5 phút)
cron.schedule('*/5 * * * *', async () => {
    try {
        const now = new Date();
        const threshold = new Date(now.getTime() - 1 * 60 * 1000);

        // const threshold = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const users = await User.find({
            telegramChatId: { $ne: null },
            telegramLinkedAt: { $lte: threshold },
            telegramBalanceSent: false
        }).limit(50);
        if (!users.length) return;
        const teleConfig = await Telegram.findOne();
        if (!teleConfig || !teleConfig.bot_notify) return;
        for (const u of users) {
            try {
                if (bot) {
                    await bot.sendMessage(u.telegramChatId, `Số dư hiện tại của bạn: ${Number(Math.floor(Number(u.balance))).toLocaleString("en-US")} VNĐ`);
                } else {
                    await axios.post(`https://api.telegram.org/bot${teleConfig.bot_notify}/sendMessage`, {
                        chat_id: u.telegramChatId,
                        text: `Số dư hiện tại của bạn: ${Number(Math.floor(Number(u.balance))).toLocaleString("en-US")} VNĐ`,
                        parse_mode: 'Markdown'
                    });
                }
                u.telegramBalanceSent = true;
                await u.save();
            } catch (e) {
                console.error('Telegram balance send fail for user', u._id.toString(), e.message);
            }
        }
    } catch (err) {
        console.error('Cron telegram balance error:', err.message);
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));


