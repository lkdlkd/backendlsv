const cron = require('node-cron');
const axios = require('axios');
const Service = require('../../models/server');
const SmmSv = require('../../models/SmmSv');

// Hàm kiểm tra và cập nhật giá dịch vụ
async function updateServicePrices() {
  try {
    // Lấy toàn bộ dịch vụ trong CSDL
    const services = await Service.find({});
    console.log(`Đang kiểm tra ${services.length} dịch vụ...`);

    // Gom nhóm các service theo DomainSmm
    const smmGroups = {};
    for (const service of services) {
      if (!smmGroups[service.DomainSmm]) smmGroups[service.DomainSmm] = [];
      smmGroups[service.DomainSmm].push(service);
    }

    // Duyệt qua từng nhóm DomainSmm, chỉ gọi API 1 lần cho mỗi nhóm
    for (const domain in smmGroups) {
      const smmSvConfig = await SmmSv.findOne({ name: domain });
      if (!smmSvConfig || !smmSvConfig.url_api || !smmSvConfig.api_token) {
        console.warn(`Cấu hình API chưa được thiết lập cho domain ${domain}`);
        continue;
      }
      let apiResponse;
      try {
        apiResponse = await axios.post(smmSvConfig.url_api, {
          key: smmSvConfig.api_token,
          action: 'services',
        });
      } catch (err) {
        console.warn(`Lỗi gọi API cho domain ${domain}:`, err.message);
        continue;
      }
      if (!apiResponse.data || !Array.isArray(apiResponse.data)) {
        console.warn(`Dữ liệu API không hợp lệ cho domain ${domain}`);
        continue;
      }
      // Duyệt qua từng service thuộc domain này
      await Promise.all(
        smmGroups[domain].map(async (serviceItem) => {
          try {
            const apiService = apiResponse.data.find(
              (s) => Number(s.service) === Number(serviceItem.serviceId)
            );
            if (!apiService) {
              console.warn(`Không tìm thấy dịch vụ ${serviceItem.serviceId} trong API cho ${serviceItem.name}`);
              serviceItem.isActive = false;
              await serviceItem.save();
              return;
            }
            const apiRate = apiService.rate * smmSvConfig.tigia;
            const dbRate = serviceItem.rate;
            serviceItem.isActive = true;
            serviceItem.originalRate = apiRate;
            await serviceItem.save();
            console.log(
              `Dịch vụ ${serviceItem.name} - id ${serviceItem.serviceId} - Giá DB: ${dbRate}, Giá API: ${apiRate}`
            );
            // Nếu giá trong CSDL thấp hơn giá API thì cập nhật
            if (dbRate < apiRate) {
              let newRate = apiRate * 1.1; // cập nhật với 10% tăng thêm
              newRate = Math.round(newRate * 10000) / 10000; // Làm tròn 2 chữ số thập phân
              const oldRate = serviceItem.rate;
              serviceItem.rate = newRate;
              await serviceItem.save();
              console.log(`Đã cập nhật giá của ${serviceItem.name} thành ${newRate}`);

              // Gửi thông báo Telegram nếu có cấu hình
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
                  });
                  console.log('Thông báo Telegram đã được gửi.');
                } catch (telegramError) {
                  console.error('Lỗi gửi thông báo Telegram:', telegramError.message);
                }
              } else {
                console.log('Thiếu thông tin cấu hình Telegram.');
              }
            } else {
              console.log(`Giá của ${serviceItem.name} đã bằng hoặc cao hơn giá API, bỏ qua cập nhật.`);
            }
          } catch (innerError) {
            console.error(`Lỗi khi xử lý dịch vụ ${serviceItem.name}:`, innerError.message);
          }
        })
      );
    }
  } catch (error) {
    console.error('Lỗi khi lấy danh sách dịch vụ:', error.message);
  }
}
const Platform = require('../../models/platform');

async function updateTypeToPlatformId() {
  const services = await Service.find({});
  console.log(`Đang cập nhật type cho ${services} dịch vụ...`);
  for (const service of services) {
    console.log('type string:', service.type);

    if (typeof service.type === 'string') {

      const platform = await Platform.findOne({ name: service.type });
      if (platform) {
        service.type = platform._id;
        console.log(`Cập nhật type cho dịch vụ ${service.name} thành ${platform._id}`);
        console.log(service)
        await service.save();
      }
    }
  }
  console.log('Cập nhật hoàn tất!');
}

// Cronjob: Kiểm tra giá dịch vụ mỗi 30 giây
setInterval(() => {
  console.log('Cron job: Kiểm tra giá dịch vụ mỗi 30 giây');
  updateServicePrices();
  // updateTypeToPlatformId();

}, 60000); // 30,000 milliseconds = 30 seconds
