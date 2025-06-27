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
const cors = require('cors');
const api = require('@/routes/api'); // Đường dẫn đúng đến file api.js
const app = express();
const noti = require('@/routes/website/notificationsRouter');
app.use(express.json());
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
        // Áp dụng CORS cho các API khác
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));


