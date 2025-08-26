const Order = require('../../models/Order');
const SmmSv = require('../../models/SmmSv');
const SmmApiService = require('../Smm/smmServices');
const HistoryUser = require('../../models/History');
// const Refill = require('../../models/Refill');
exports.refillOrder = async (req, res) => {
    try {
        const { madon } = req.body;
        if (!madon) return res.status(400).json({ error: 'Thiếu mã đơn' });
        const user = req.user;

        // Tìm đơn hàng theo madon
        const order = await Order.findOne({ Madon: madon });
        if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
        // Kiểm tra quyền hủy đơn
        // Kiểm tra quyền hủy đơn
        if (user.role !== 'admin' && order.username !== user.username) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện!' });
        }

        // Lấy config SmmSv theo domain
        const smmConfig = await SmmSv.findOne({ name: order.DomainSmm });
        if (!smmConfig) return res.status(400).json({ error: 'Lỗi liên hệ admin!1' });
        // Tạo instance SmmApiService
        const smmApi = new SmmApiService(smmConfig.url_api, smmConfig.api_token);

        // Gọi hàm refill đến API thứ 3
        const apiResult = await smmApi.refill(order.orderId);

        if (apiResult.error) {
            return res.status(400).json({ success: false, error: "Lỗi thử lại , liên hệ admin" });
        }
        const historyData = new HistoryUser({
            username: order.username,
            madon: order.Madon,
            hanhdong: "Bảo hành",
            link: order.link,
            tienhientai: user.balance,
            tongtien: 0,
            tienconlai: user.balance,
            createdAt: new Date(),
            mota: `Bảo hành dịch vụ ${order.namesv} thành công cho uid ${order.link}`,
        });
        await historyData.save();
        // const refillData = new Refill({
        //     username: order.username,
        //     mabaohanh: apiResult.refill, // Mã bảo hành từ API
        //     madon: order.Madon,
        //     link: order.link,
        //     server: order.namesv,
        //     soluongmua: order.quantity,
        //     goc: order.start,
        //     thoigianmua: order.createdAt,
        //     trangthai: 'pending', // Trạng thái ban đầu
        // });
        // await refillData.save();
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
        if (user.role !== 'admin' && order.username !== user.username) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện!' });
        }
        if (order.iscancel) {
            return res.status(400).json({ success: false, error: 'Đơn hàng đã được hủy!' });
        }
        if (order.status === "Completed") return res.status(400).json({success: false, error: 'Đơn hàng đã hoàn thành không thể hủy' });
        if (order.status === "Partial" || order.status === "Canceled") return res.status(400).json({success: false, error: 'Đơn hàng đã được hủy' });
        if (order.cancel !== "on") return res.status(400).json({success: false, error: 'Đơn hàng không hỗ trợ hủy' });
        // Lấy config SmmSv theo domain
        const smmConfig = await SmmSv.findOne({ name: order.DomainSmm });
        if (!smmConfig) return res.status(400).json({ error: 'Lỗi liên hệ admin!1' });
        // Tạo instance SmmApiService
        const smmApi = new SmmApiService(smmConfig.url_api, smmConfig.api_token);

        // Gọi hàm cancel đến API thứ 3
        let apiResult = await smmApi.cancel2(order.orderId);
        let cancelError = null;
        if (Array.isArray(apiResult)) {
            cancelError = apiResult[0]?.cancel?.error;
        } else if (apiResult.error) {
            cancelError = apiResult.error;
        }
        // Nếu lỗi thì thử gọi cancel2
        if (cancelError) {
            let apiResult2 = await smmApi.cancel([order.orderId]);
            let cancelError2 = null;
            if (apiResult2) {
                if (Array.isArray(apiResult2)) {
                    cancelError2 = apiResult2[0]?.cancel?.error;
                } else if (apiResult2.error) {
                    cancelError2 = apiResult2.error;
                }
            } else {
                cancelError2 = 'Lỗi thử lại, liên hệ admin2';
            }
            if (cancelError2) {
                return res.status(404).json({ success: false, error: "Đơn hàng không thể hủy" });
            } else {
                // cancel2 thành công
                const historyData = new HistoryUser({
                    username: order.username,
                    madon: order.Madon,
                    hanhdong: "Hủy đơn",
                    link: order.link,
                    tienhientai: user.balance,
                    tongtien: 0,
                    tienconlai: user.balance,
                    createdAt: new Date(),
                    mota: `Hủy đơn dịch vụ ${order.namesv} uid => ${order.link}`,
                });
                await historyData.save();
                order.iscancel = true;
                await order.save();
                return res.json({ success: true, message: 'Đơn hàng đã được hủy thành công' });
            }
        } else {
            // cancel thành công
            const historyData = new HistoryUser({
                username: order.username,
                madon: order.Madon,
                hanhdong: "Hủy đơn",
                link: order.link,
                tienhientai: user.balance,
                tongtien: 0,
                tienconlai: user.balance,
                createdAt: new Date(),
                mota: `Hủy đơn dịch vụ ${order.namesv} uid => ${order.link}`,
            });
            await historyData.save();
            order.iscancel = true;
            await order.save();
            return res.json({ success: true, message: 'Đơn hàng đã được hủy thành công' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi liên hệ admin!' });
    }
};