const Order = require('../../models/Order');
const SmmSv = require('../../models/SmmSv');
const SmmApiService = require('../Smm/smmServices');


exports.refillOrder = async (req, res) => {
    try {
        const { madon } = req.body;
        if (!madon) return res.status(400).json({ error: 'Thiếu mã đơn' });
        const user = req.user;

        // Tìm đơn hàng theo madon
        const order = await Order.findOne({ Madon: madon });
        if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
        // Kiểm tra quyền hủy đơn
        if (order.username !== user.username) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền hủy đơn này!' });
        }
        // Lấy config SmmSv theo domain
        const smmConfig = await SmmSv.findOne({ name: order.DomainSmm });
        if (!smmConfig) return res.status(400).json({ error: 'Lỗi liên hệ admin!' });
        // Tạo instance SmmApiService
        const smmApi = new SmmApiService(smmConfig.url_api, smmConfig.api_token);

        // Gọi hàm refill đến API thứ 3
        const apiResult = await smmApi.refill(order.orderId);

        if (apiResult.error) {
            return res.status(400).json({ success: false, error:"Lỗi thử lại , liên hệ admin" });
        }

        res.json({ success: true, message: 'Đơn hàng đã được bảo hành thành công' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi liên hệ admin!' });
    }
};

// Hàm hủy đơn
exports.cancelOrder = async (req, res) => {
    try {
        const { madon } = req.body;
        const user = req.user;
        if (!madon) return res.status(400).json({ error: 'Thiếu mã đơn' });

        // Tìm đơn hàng theo madon
        const order = await Order.findOne({ Madon: madon });
        if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

        // Kiểm tra quyền hủy đơn
        if (order.username !== user.username) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền hủy đơn này!' });
        }

        // Lấy config SmmSv theo domain
        const smmConfig = await SmmSv.findOne({ name: order.DomainSmm });
        if (!smmConfig) return res.status(400).json({ error: 'Lỗi liên hệ admin!' });
        // Tạo instance SmmApiService
        const smmApi = new SmmApiService(smmConfig.url_api, smmConfig.api_token);

        // Gọi hàm cancel đến API thứ 3
        const apiResult = await smmApi.cancel([order.orderId]);
        // Xử lý trường hợp trả về mảng có cancel.error
        if (Array.isArray(apiResult)) {
            const cancelError = apiResult[0]?.cancel?.error;
            if (cancelError) {
                return res.status(400).json({ success: false, error: "Lỗi thử lại, liên hệ admin" });
            }
        } else if (apiResult.error) {
            return res.status(400).json({ success: false, error: "Lỗi thử lại , liên hệ admin" });
        }

        // Hủy đơn thành công, cập nhật trạng thái iscancel
        order.iscancel = true;
        await order.save();
        res.json({ success: true, message: 'Đơn hàng đã được hủy thành công' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi liên hệ admin!' });
    }
};