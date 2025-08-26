const Refund = require('../../models/Refund');

const User = require('../../models/User');
const HistoryUser = require('../../models/History');
const Telegram = require('../../models/Telegram');
const axios = require('axios');

exports.getRefunds = async (req, res) => {
    try {
        const user = req.user;
        const { status } = req.query;

        let filter = {};
        if (!user) {
            return res.status(401).json({ error: 'Không xác thực được người dùng' });
        }
        filter.status = status ;
        const refunds = await Refund.find(filter).sort({ createdAt: -1 });
        return res.status(200).json({ success: true, data: refunds });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

// Controller: Admin cập nhật status hoàn tiền thành true
exports.adminApproveRefund = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Chỉ admin mới có quyền duyệt hoàn tiền.' });
        }
        const { madon } = req.body;
        if (!madon) {
            return res.status(400).json({ error: 'Thiếu mã đơn.' });
        }
        const refund = await Refund.findOne({ madon });
        if (!refund) {
            return res.status(404).json({ error: 'Không tìm thấy đơn hoàn tiền.' });
        }
        if (refund.status === true) {
            return res.status(400).json({ error: 'Đơn đã được duyệt hoàn tiền.' });
        }
        // Cập nhật status thành true
        refund.status = true;
        await refund.save();
        // Thực hiện hoàn tiền cho user
        const targetUser = await User.findOne({ username: refund.username });
        if (!targetUser) {
            return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
        }
        const tiencu = targetUser.balance || 0;
        targetUser.balance = targetUser.balance + refund.tonghoan;
        await targetUser.save();
        // Lưu lịch sử hoàn tiền
        const historyData = new HistoryUser({
            username: refund.username,
            madon: refund.madon,
            hanhdong: 'Hoàn tiền',
            link: refund.link || '',
            tienhientai: tiencu,
            tongtien: refund.tonghoan,
            tienconlai: targetUser.balance,
            createdAt: new Date(),
            mota: `${refund.noidung}`,
        });
        await historyData.save();
        const soTienHoanFormatted = Number(Math.round(refund.tonghoan)).toLocaleString("en-US");

        // Gửi thông báo Telegram nếu có cấu hình
        const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const teleConfig = await Telegram.findOne();
        if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
            const telegramMessage =
                `📌 *THÔNG BÁO HOÀN TIỀN!*\n` +
                `👤 *Khách hàng:* ${refund.username}\n` +
                `🆔 *Mã đơn:* ${refund.madon}\n` +
                `💰 *Số tiền hoàn:* ${soTienHoanFormatted}\n` +
                `🔹 *Số lượng chưa chạy:* ${refund.chuachay} - Rate: ${refund.giatien}\n` +
                `🔸 *Dịch vụ:* ${refund.server}\n` +
                `⏰ *Thời gian:* ${taoluc.toLocaleString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                })}\n`;
            try {
                await axios.post(`https://api.telegram.org/bot${teleConfig.botToken}/sendMessage`, {
                    chat_id: teleConfig.chatId,
                    text: telegramMessage,
                    parse_mode: 'Markdown',
                });
            } catch (telegramError) {
                console.error('Lỗi gửi thông báo Telegram:', telegramError.message);
            }
        }
        return res.status(200).json({ success: true, message: 'Duyệt hoàn tiền thành công.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
