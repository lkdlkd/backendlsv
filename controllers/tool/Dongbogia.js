const axios = require('axios');
const Service = require('../../models/server');
const SmmSv = require('../../models/SmmSv');

// // Controller đồng bộ giá dịch vụ từ SMM provider (chỉ cho admin)
// exports.syncPrices = async (req, res) => {
//   try {
//     // Kiểm tra quyền admin
//     if (!req.user || req.user.role !== 'admin') {
//       return res.status(403).json({ success: false, message: 'Chỉ admin mới được phép đồng bộ giá!' });
//     }

//     // Lấy toàn bộ dịch vụ trong CSDL
//     const services = await Service.find({});
//     let updatedCount = 0;
//     let skippedCount = 0;
//     let errors = [];

//     // Duyệt qua từng dịch vụ
//     await Promise.all(
//       services.map(async (serviceItem) => {
//         try {
//           // Lấy cấu hình API theo DomainSmm của dịch vụ hiện tại
//           const smmSvConfig = await SmmSv.findOne({ name: serviceItem.DomainSmm });
//           if (!smmSvConfig || !smmSvConfig.url_api || !smmSvConfig.api_token) {
//             skippedCount++;
//             return;
//           }

//           // Gọi API bên thứ 3 để lấy danh sách dịch vụ
//           const apiResponse = await axios.post(smmSvConfig.url_api, {
//             key: smmSvConfig.api_token,
//             action: 'services',
//           });

//           if (!apiResponse.data || !Array.isArray(apiResponse.data)) {
//             skippedCount++;
//             return;
//           }

//           // Tìm dịch vụ có serviceId tương ứng trong kết quả API
//           const apiService = apiResponse.data.find(
//             (s) => Number(s.service) === Number(serviceItem.serviceId)
//           );
//           if (!apiService) {
//             skippedCount++;
//             return;
//           }

//           // Lấy giá từ API và so sánh với giá trong CSDL
//           const apiRate = apiService.rate * (smmSvConfig.tigia || 1);
//           const dbRate = serviceItem.rate;

//           // Nếu giá trong CSDL thấp hơn giá API thì cập nhật
//           if (dbRate < apiRate) {
//             // Nếu không có price_update thì mặc định tăng 10%
//             const priceUpdatePercent = smmSvConfig.price_update || 1.1;
//             const newRate = Math.round(apiRate * priceUpdatePercent);
//             const oldRate = serviceItem.rate;
//             serviceItem.rate = newRate;
//             await serviceItem.save();
//             updatedCount++;

//             // Gửi thông báo Telegram nếu có cấu hình
//             const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
//             const telegramChatId = process.env.TELEGRAM_CHAT_ID;
//             if (telegramBotToken && telegramChatId) {
//               const telegramMessage = `📌 *Cập nhật giá!*\n\n` +
//                 `👤 *Dịch vụ:* ${serviceItem.name}\n` +
//                 `🔹 *Giá cũ:* ${oldRate}\n` +
//                 `🔹 *Giá mới:* ${newRate}\n` +
//                 `🔹 *Site:* ${smmSvConfig.name}\n` +
//                 `🔹 *Thời gian:* ${new Date().toLocaleString()}\n`;
//               try {
//                 await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
//                   chat_id: telegramChatId,
//                   text: telegramMessage,
//                   parse_mode: "Markdown"
//                 });
//               } catch (telegramError) {
//                 // Không dừng lại nếu lỗi gửi Telegram
//               }
//             }
//           } else {
//             skippedCount++;
//           }
//         } catch (innerError) {
//           errors.push({ service: serviceItem.name, error: innerError.message });
//         }
//       })
//     );

//     return res.json({
//       success: true,
//       message: `Đồng bộ giá hoàn tất! Đã cập nhật ${updatedCount} dịch vụ, bỏ qua ${skippedCount} dịch vụ.`,
//       errors
//     });
//   } catch (error) {
//     return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đồng bộ giá!', error: error.message });
//   }
// };

// Đồng bộ giá theo id SMM (hoặc tên provider)
exports.syncPricesBySmmId = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ admin mới được phép đồng bộ giá!' });
    }

    const { smmId, smmName } = req.body;
    let smmQuery = {};
    if (smmId) smmQuery._id = smmId;
    if (smmName) smmQuery.name = smmName;

    // Lấy thông tin SMM provider
    const smmSvConfig = await SmmSv.findOne(smmQuery);
    if (!smmSvConfig) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy SMM provider!' });
    }

    // Lấy các dịch vụ thuộc provider này
    const services = await Service.find({ DomainSmm: smmSvConfig.name });
    if (!services.length) {
      return res.json({ success: false, message: 'Không có dịch vụ nào thuộc SMM provider này!' });
    }

    // Gọi API lấy danh sách dịch vụ từ provider
    const apiResponse = await axios.post(smmSvConfig.url_api, {
      key: smmSvConfig.api_token,
      action: 'services',
    });

    if (!apiResponse.data || !Array.isArray(apiResponse.data)) {
      return res.json({ success: false, message: 'Không lấy được danh sách dịch vụ từ SMM provider!' });
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let errors = [];

    await Promise.all(
      services.map(async (serviceItem) => {
        try {
          const apiService = apiResponse.data.find(
            (s) => Number(s.service) === Number(serviceItem.serviceId)
          );
          if (!apiService) {
            skippedCount++;
            return;
          }
          const apiRate = apiService.rate * (smmSvConfig.tigia || 25);
          const dbRate = serviceItem.rate;
          if (dbRate < apiRate) {
            const priceUpdatePercent = smmSvConfig.price_update || 1.1;
            const newRate = Math.round(apiRate * priceUpdatePercent);
            const oldRate = serviceItem.rate;
            serviceItem.rate = newRate;
            await serviceItem.save();
            updatedCount++;
            // Gửi Telegram nếu có cấu hình
            const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
            const telegramChatId = process.env.TELEGRAM_CHAT_ID;
            if (telegramBotToken && telegramChatId) {
              const telegramMessage = `📌 *Cập nhật giá!*\n\n` +
                `👤 *Dịch vụ:* ${serviceItem.name}\n` +
                `🔹 *Giá cũ:* ${oldRate}\n` +
                `🔹 *Giá mới:* ${newRate}\n` +
                `🔹 *Site:* ${smmSvConfig.name}\n` +
                `🔹 *Thời gian:* ${new Date().toLocaleString()}\n`;
              try {
                await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                  chat_id: telegramChatId,
                  text: telegramMessage,
                  parse_mode: "Markdown"
                });
              } catch (telegramError) {}
            }
          } else {
            skippedCount++;
          }
        } catch (innerError) {
          errors.push({ service: serviceItem.name, error: innerError.message });
        }
      })
    );

    return res.json({
      success: true,
      message: `Đồng bộ giá hoàn tất cho provider ${smmSvConfig.name}! Đã cập nhật ${updatedCount} dịch vụ, bỏ qua ${skippedCount} dịch vụ.`,
      errors
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đồng bộ giá!', error: error.message });
  }
};