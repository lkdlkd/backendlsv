const SmmSv = require("../../models/SmmSv");
const SmmApiService = require('../../controllers/Smm/smmServices'); // Đảm bảo đường dẫn đúng đến SmmApiService

// Cấu hình giới hạn & timeout khi gọi balance từ đối tác
const BALANCE_CONCURRENCY = 3; // Số request song song tối đa
const BALANCE_TIMEOUT_MS = 5000; // Timeout cho mỗi đối tác (ms)

// Hàm giới hạn concurrency thủ công (không cần thêm thư viện)
async function mapLimited(items, limit, iterator) {
    const results = [];
    const executing = [];
    for (let i = 0; i < items.length; i++) {
        const p = Promise.resolve(iterator(items[i], i)).finally(() => {
            const idx = executing.indexOf(p);
            if (idx > -1) executing.splice(idx, 1);
        });
        results.push(p);
        executing.push(p);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// Helper timeout
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

// Thêm mới một đối tác SMM
exports.createPartner = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const newPartner = new SmmSv(req.body);
        await newPartner.save();
        res.status(201).json({ message: "Đã thêm đối tác SMM thành công!", data: newPartner });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lấy danh sách tất cả đối tác SMM
exports.getAllPartners = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const partners = await SmmSv.find();

        // Query params:
        // includeBalance=0  => bỏ qua gọi API balance (trả về nhanh)
        // timeout=ms         => override timeout mỗi partner
        // concurrency=n      => override số gọi song song
        const includeBalance = req.query.includeBalance !== '0';
        const timeoutMs = req.query.timeout ? Math.max(1000, parseInt(req.query.timeout)) : BALANCE_TIMEOUT_MS;
        const concurrency = req.query.concurrency ? Math.max(1, parseInt(req.query.concurrency)) : BALANCE_CONCURRENCY;

        if (!includeBalance) {
            return res.status(200).json(partners.map(p => ({ ...p.toObject(), balance: null, balanceError: null, balanceStatus: 'skipped' })));
        }

        const partnersWithBalance = await mapLimited(partners, concurrency, async (partner) => {
            let balance = null;
            let balanceError = null;
            let balanceStatus = 'idle';
            if (partner.status === 'on' && partner.url_api && partner.api_token) {
                const smmService = new SmmApiService(partner.url_api, partner.api_token);
                try {
                    balanceStatus = 'fetching';
                    const balanceData = await withTimeout(smmService.balance(), timeoutMs);
                    let rawBalance = parseFloat(balanceData.balance);
                    if (Number.isNaN(rawBalance)) throw new Error('invalid balance format');
                    if (balanceData.currency === 'USD') {
                        balance = rawBalance * (partner.tigia || 1) * 1000;
                    } else if (balanceData.currency === 'XU') {
                        balance = rawBalance * (partner.tigia || 1);
                    } else {
                        balance = rawBalance;
                    }
                    balanceStatus = 'ok';
                } catch (err) {
                    balanceError = err.message === 'timeout' ? `Timeout sau ${timeoutMs}ms` : err.message;
                    balanceStatus = err.message === 'timeout' ? 'timeout' : 'error';
                }
            } else {
                balanceStatus = 'inactive';
            }
            return { ...partner.toObject(), balance, balanceError, balanceStatus };
        });

        res.status(200).json(partnersWithBalance);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lấy thông tin một đối tác SMM theo ID
exports.getPartnerById = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const partner = await SmmSv.findById(req.params.id);
        if (!partner) {
            return res.status(404).json({ message: "Không tìm thấy đối tác SMM!" });
        }
        res.status(200).json(partner);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Cập nhật thông tin đối tác SMM
exports.updatePartner = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const updatedPartner = await SmmSv.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedPartner) {
            return res.status(404).json({ message: "Không tìm thấy đối tác SMM!" });
        }
        res.status(200).json({ message: "Cập nhật thành công!", data: updatedPartner });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Xóa đối tác SMM
exports.deletePartner = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const deletedPartner = await SmmSv.findByIdAndDelete(req.params.id);
        if (!deletedPartner) {
            return res.status(404).json({ message: "Không tìm thấy đối tác SMM!" });
        }
        res.status(200).json({ message: "Xóa thành công!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
