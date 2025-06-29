const cron = require('node-cron');
const Service = require('../../models/server');

// Cronjob: cập nhật tốc độ dự kiến cho tất cả dịch vụ mỗi 10 phút
cron.schedule('*/5 * * * *', async () => {
  console.log('Cronjob: Bắt đầu cập nhật tốc độ dự kiến cho tất cả dịch vụ...');
  const results = await Service.updateAllTocDoDuKien();
  console.log('Kết quả cập nhật tốc độ:', results);
});

// Nếu muốn chạy ngay khi khởi động file
(async () => {
  const results = await Service.updateAllTocDoDuKien();
  console.log('Kết quả cập nhật tốc độ (lần đầu):', results);
})();
