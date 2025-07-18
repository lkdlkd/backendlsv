// const Order = require('../../models/Order');
// const SmmSv = require('../../models/SmmSv');
// const SmmApiService = require('../Smm/smmServices');

// exports.refillOrder = async (req, res) => {
//     try {
//         const { madon } = req.body;
//         if (!madon) return res.status(400).json({ error: 'Thiếu mã đơn (madon)' });

//         // Tìm đơn hàng theo madon
//         const order = await Order.findOne({ Madon: madon });
//         if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

//         // Lấy config SmmSv theo domain
//         const smmConfig = await SmmSv.findOne({ name: order.DomainSmm });
//         if (!smmConfig) return res.status(400).json({ error: 'Lỗi liên hệ admin!' });
//         // Tạo instance SmmApiService
//         const smmApi = new SmmApiService(smmConfig.url_api, smmConfig.api_token);

//         // Gọi hàm refill đến API thứ 3
//         const apiResult = await smmApi.refill(order.orderId);
        
//         if (apiResult.error) {
//             return res.status(400).json({ success: false, error: apiResult.error });
//         }

//         res.json({ success: true, apiResult });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// };