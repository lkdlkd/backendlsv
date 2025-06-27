const axios = require('axios');
const jwt = require('jsonwebtoken');
const Service = require('../../models/server');
const Order = require('../../models/Order');
const HistoryUser = require('../../models/History');
const User = require('../../models/User');
const SmmSv = require("../../models/SmmSv");
const SmmApiService = require('../Smm/smmServices'); // Giả sử bạn có một lớp để xử lý API SMM

/* Hàm lấy danh sách dịch vụ */
exports.getServices = async (req, res) => {
    try {
        const { key } = req.body;
        // Kiểm tra xem token có được gửi không
        // Kiểm tra xem token có được gửi không
        if (!key) {
            return res.status(400).json({ success: false, error: "Token không được bỏ trống" });
        }
        // Lấy user từ DB dựa trên userId từ decoded token
        const user = await User.findOne({ apiKey: key });
        if (!user) {
            res.status(404).json({ error: 'Người dùng không tồn tại' });
            return null;
        }

        // So sánh token trong header với token đã lưu của user
        if (user.apiKey !== key) {
            res.status(401).json({ error: 'api Key không hợp lệ1' });
            return null;
        }
        // Kiểm tra trạng thái người dùng trong CSDL (ví dụ: 'active')
        if (!user) {
            return res.status(404).json({ success: false, error: "Không tìm thấy người dùng" });
        }
        if (user.status && user.status !== 'active') {
            return res.status(403).json({ success: false, error: "Người dùng không hoạt động" });
        }
        // Lấy danh sách dịch vụ từ CSDL
        const services = await Service.find()
            .populate("category", "name"); // Lấy thông tin tên của Category
        // Định dạng các trường cần hiển thị
        const formattedServices = services.map(service => ({
            service: service.Magoi,
            name: `${service.maychu} ${service.name}`, // Đảm bảo có khoảng trắng
            type: "Default", // Hoặc lấy từ service.type nếu có
            category: service.category.name || "Không xác định", // Kiểm tra nếu category tồn tại
            rate: service.rate / 25,
            min: service.min,
            max: service.max,
            cancel: false,
            refill: false,
        }));

        return res.status(200).json(formattedServices);
    } catch (error) {
        console.error("Lỗi khi lấy danh sách dịch vụ:", error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách dịch vụ',
            error: error.message
        });
    }
};
async function fetchSmmConfig(domain) {
    const smmSvConfig = await SmmSv.findOne({ name: domain });
    if (!smmSvConfig || !smmSvConfig.url_api || !smmSvConfig.api_token) {
        throw new Error('Lỗi khi mua dịch vụ, vui lòng ib admin');
    }
    return smmSvConfig;
}

async function fetchServiceData(magoi) {
    const serviceFromDb = await Service.findOne({ Magoi: magoi }).populate("category", "name");;
    if (!serviceFromDb) throw new Error('Dịch vụ không tồn tại');
    return serviceFromDb;
}
exports.AddOrder = async (req, res) => {
    // Lấy token từ req.body
    const { key, service, link, quantity, comments } = req.body;
    const magoi = service;

    if (!key) {
        return res.status(400).json({ error: "Token không được bỏ trống" });
    }
    const user = await User.findOne({ apiKey: key });
    if (!user) {
        res.status(404).json({ error: 'Người dùng không tồn tại' });
        return null;
    }
    if (user.apiKey !== key) {
        res.status(401).json({ error: 'api Key không hợp lệ1' });
        return null;
    }
    if (!user) {
        return res.status(404).json({ success: false, error: "Không tìm thấy người dùng" });
    }
    if (user.status && user.status !== 'active') {
        return res.status(403).json({ success: false, error: "Người dùng không hoạt động" });
    }


    const username = user.username
    const qty = Number(quantity);
    const formattedComments = comments ? comments.replace(/\r?\n/g, "\r\n") : "";

    try {
        // --- Bước 1: Lấy thông tin dịch vụ từ CSDL ---
        const serviceFromDb = await fetchServiceData(magoi);
        const smmSvConfig = await fetchSmmConfig(serviceFromDb.DomainSmm);

        const smm = new SmmApiService(smmSvConfig.url_api, smmSvConfig.api_token);
        const allServices = await smm.services();
        console.log('Service from API:', serviceFromDb.serviceId);

        console.log('All Services:', allServices);
        const serviceFromApi = allServices.find(
            s => s.service === Number(serviceFromDb.serviceId) || s.service === serviceFromDb.serviceId
        );
        console.log('Service from API:', serviceFromApi);
        if (!serviceFromApi) throw new Error('lỗi khi mua dịch vụ, vui lòng ib admin11');


        // Tính tổng chi phí và làm tròn 2 số thập phân
        const totalCost = serviceFromDb.rate * qty; // Kết quả: 123.4
        const apiRate = serviceFromApi.rate * smmSvConfig.tigia;
        if (apiRate > serviceFromDb.rate) {
            return res.status(400).json({ error: 'Lỗi khi mua dịch vụ, vui lòng ib admin' });
        }

        if (!serviceFromDb.isActive) {
            return res.status(400).json({ error: "Dịch vụ bảo trì, vui lòng mua sv khác" });
        }
        if (qty < serviceFromDb.min || qty > serviceFromDb.max) {
            throw new Error('Số lượng không hợp lệ');
        }
        if (user.balance < totalCost) {
            throw new Error('Số dư không đủ để thực hiện giao dịch');
        }
        if (serviceFromDb.isActive === false) {
            throw new Error('Dịch vụ bảo trì, vui lòng liên hệ admin');
        }
        // --- Bước 4: Gửi yêu cầu mua dịch vụ qua API bên thứ 3 ---
        const purchasePayload = {
            link,
            quantity: qty,
            service: serviceFromDb.serviceId,
            comments: formattedComments,
        };

        const purchaseResponse = await smm.order(purchasePayload);
        if (!purchaseResponse || !purchaseResponse.order) {
            throw new Error('Lỗi khi mua dịch vụ, vui lòng thử lại sau');
        }

        // --- Bước 5: Trừ số tiền vào tài khoản người dùng ---
        const newBalance = user.balance - totalCost;
        user.balance = newBalance;
        await user.save();

        // --- Bước 6: Tạo mã đơn (Madon) ---
        const lastOrder = await Order.findOne({}).sort({ Madon: -1 });
        const newMadon = lastOrder && lastOrder.Madon ? Number(lastOrder.Madon) + 1 : 10000;

        // --- Bước 7: Tạo đối tượng đơn hàng và lưu vào CSDL ---
        const createdAt = new Date();
        const orderData = new Order({
            Madon: newMadon,
            username,
            SvID: serviceFromDb.serviceId,
            orderId: purchaseResponse.order,
            namesv: `${serviceFromDb.maychu} ${serviceFromDb.name}`,
            category: serviceFromDb.category.name || "Không xác định", // Kiểm tra nếu category tồn tại
            link,
            start: 0,
            quantity: qty,
            rate: serviceFromDb.rate,
            totalCost,
            createdAt,
            status: 'Pending',
            note: "",  // Gán mặc định là chuỗi rỗng khi không có note
            comments: formattedComments,
        });

        const HistoryData = new HistoryUser({
            username,
            madon: newMadon,
            hanhdong: 'Tạo đơn hàng',
            link,
            tienhientai: user.balance + totalCost,
            tongtien: totalCost,
            tienconlai: newBalance,
            createdAt,
            mota: `Tăng ${serviceFromDb.maychu} ${serviceFromDb.name} thành công cho uid ${link}`,
        });

        console.log('Order:', orderData);
        console.log('History:', HistoryData);

        await orderData.save();
        await HistoryData.save();

        console.log('Order saved successfully!');

        // --- Bước 8: Gửi thông báo về Telegram ---
        const telegramMessage = `📌 *Đơn hàng mới đã được tạo!*\n\n` +
            `👤 *Khách hàng:* ${username}\n` +
            `🔹 *Dịch vụ:* ${serviceFromDb.name}\n` +
            `🔗 *Link:* ${link}\n` +
            `📌 *Số lượng:* ${qty}\n` +
            `💰 *Tiền cũ:* ${(user.balance + totalCost).toLocaleString()} VNĐ\n` +
            `💰 *Tổng tiền:* ${totalCost.toLocaleString()} VNĐ\n` +
            `💰 *TIền còn lại:* ${newBalance.toLocaleString()} VNĐ\n` +
            `🆔 *Mã đơn:* ${newMadon}\n` +
            `📆 *Ngày tạo:* ${createdAt.toLocaleString()}\n` +
            `📝 *Ghi chú:* ${'Không có'}`;

        await sendTelegramNotification({
            telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
            telegramChatId: process.env.TELEGRAM_CHAT_ID,
            message: telegramMessage,
        });
        res.status(200).json({ order: newMadon });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Không thể thêm đơn hàng', error: error.message });
    }
};

async function sendTelegramNotification(data) {
    const { telegramBotToken, telegramChatId, message } = data;
    if (telegramBotToken && telegramChatId) {
        try {
            await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                chat_id: telegramChatId,
                text: message,
            });
            console.log('Thông báo Telegram đã được gửi.');
        } catch (error) {
            console.error('Lỗi gửi thông báo Telegram:', error.message);
        }
    } else {
        console.log('Thiếu thông tin cấu hình Telegram.');
    }
}

/* Hàm lấy danh sách dịch vụ */
exports.getOrderStatus = async (req, res) => {
    try {
        const { key, order, orders } = req.body;

        // Kiểm tra xem API key có được gửi không
        if (!key) {
            return res.status(400).json({ error: "Token không được bỏ trống" });
        }

        // Tìm user dựa trên apiKey
        const user = await User.findOne({ apiKey: key });
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }

        // Kiểm tra trạng thái người dùng
        if (user.status && user.status !== 'active') {
            return res.status(403).json({ error: "Người dùng không hoạt động" });
        }

        // Xử lý trường hợp có `orders` hoặc `order`
        let orderNumbers = [];

        if (orders) {
            // `orders` là danh sách đơn hàng, cần format thành object
            orderNumbers = Array.isArray(orders)
                ? orders.map(num => Number(num))
                : orders.split(',').map(num => Number(num.trim()));
        } else if (order) {
            // `order` là danh sách hoặc một đơn duy nhất
            orderNumbers = [Number(order)];

        } else {
            return res.status(400).json({ error: "Danh sách đơn hàng không được bỏ trống" });
        }

        // Lấy các đơn hàng từ DB
        const orderDocs = await Order.find({
            Madon: { $in: orderNumbers },
            // username: user.username // Kiểm tra đơn hàng có thuộc về user không
        });
        if (orders) {
            // Nếu có `orders`, trả về object với `Madon` làm key
            const formattedOrders = {};
            orderDocs.forEach(order => {
                if (order.username === user.username) {
                    formattedOrders[order.Madon] = {
                        charge: order.totalCost,
                        start_count: order.start,
                        status: order.status,
                        remains: order.quantity - order.dachay,
                        note: order.note || "",
                        currency: "VND"
                    };
                }
                else {
                    formattedOrders[order.Madon] = {
                        error: "Incorrect order ID"
                    };
                }
            });
            return res.status(200).json(formattedOrders);
        }
        // Giả sử orderDocs là mảng các đơn hàng từ DB
        if (orderDocs.length > 0) {
            const firstOrder = orderDocs[0];
            let formattedOrder;
            if (firstOrder.username === user.username) {
                formattedOrder = {
                    charge: firstOrder.totalCost,
                    start_count: firstOrder.start,
                    status: firstOrder.status,
                    remains: firstOrder.quantity - firstOrder.dachay,
                    note: firstOrder.note || "",
                    currency: "VND"
                };
            } else {
                formattedOrder = { order: firstOrder.Madon, error: "Incorrect order ID" };
            }
            return res.status(200).json(formattedOrder);
        } else {
            return res.status(200).json({ error: "Order not found" });
        }


        return res.status(200).json(formattedList);


        // Nếu có `order`, trả về danh sách

    } catch (error) {
        console.error("Lỗi khi lấy trạng thái đơn:", error);
        return res.status(500).json({
            error: "Lỗi khi lấy trạng thái đơn",
        });
    }
};

exports.getme = async (req, res) => {
    try {
        const { key } = req.body;

        // Kiểm tra xem token có được gửi không
        if (!key) {
            return res.status(400).json({ error: "Token không được bỏ trống" });
        }
        // Lấy user từ DB dựa trên userId từ decoded token
        const user = await User.findOne({ apiKey: key });
        if (!user) {
            res.status(404).json({ error: 'Người dùng không tồn tại' });
            return null;
        }

        // So sánh token trong header với token đã lưu của user
        if (user.apiKey !== key) {
            res.status(401).json({ error: 'api Key không hợp lệ1' });
            return null;
        }
        // Kiểm tra trạng thái người dùng trong CSDL (ví dụ: 'active')
        if (!user) {
            return res.status(404).json({ error: "Không tìm thấy người dùng" });
        }
        if (user.status && user.status !== 'active') {
            return res.status(403).json({ error: "Người dùng không hoạt động" });
        }
        // Định dạng các trường cần hiển thị (có thể điều chỉnh theo yêu cầu)
        const userForm = {
            balance: user.balance / 25,
            currency: "USD",
            // Các trường khác nếu cần
        };
        return res.status(200).json(userForm);
    } catch (error) {
        console.error("Lỗi khi lấy thông tin:", error);
        return res.status(500).json({
            error: "Lỗi khi lấy thông tin",
        });
    }
};
/* Hàm điều phối dựa trên giá trị của action trong body */
exports.routeRequest = async (req, res) => {
    const { action } = req.body;

    if (action === 'services') {
        // Gọi hàm lấy danh sách dịch vụ
        return exports.getServices(req, res);
    } else if (action === 'add') {
        // Gọi hàm tạo đơn hàng
        return exports.AddOrder(req, res);
    } else if (action === 'status') {
        // Gọi hàm tạo get trạng thái
        return exports.getOrderStatus(req, res);
    } else if (action === 'balance') {
        // Gọi hàm tạo get trạng thái
        return exports.getme(req, res);
    }
    else {
        return res.status(400).json({ error: "Action không hợp lệ" });
    }
};
