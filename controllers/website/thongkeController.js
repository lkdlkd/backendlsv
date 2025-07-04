const moment = require("moment");
const User = require("../../models/User");
const Order = require("../../models/Order");
const Deposit = require("../../models/History");
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

// Hàm lấy thời gian bắt đầu và kết thúc theo range
// function getRange(range) {
//     const now = moment();
//     let start, end;
//     switch (range) {
//         case "today":
//             start = now.clone().startOf("day");
//             end = now.clone().endOf("day");
//             break;
//         case "yesterday":
//             start = now.clone().subtract(1, "day").startOf("day");
//             end = now.clone().subtract(1, "day").endOf("day");
//             break;
//         case "this_week":
//             start = now.clone().startOf("week");
//             end = now.clone().endOf("week");
//             break;
//         case "last_week":
//             start = now.clone().subtract(1, "week").startOf("week");
//             end = now.clone().subtract(1, "week").endOf("week");
//             break;
//         case "this_month":
//             start = now.clone().startOf("month");
//             end = now.clone().endOf("month");
//             break;
//         case "last_month":
//             start = now.clone().subtract(1, "month").startOf("month");
//             end = now.clone().subtract(1, "month").endOf("month");
//             break;
//         default:
//             start = now.clone().startOf("day");
//             end = now.clone().endOf("day");
//     }
//     return { start: start.toDate(), end: end.toDate() };
// }

// Chuẩn hoá range: today, yesterday, this_week, last_week, this_month, last_month
function getRange(range) {
    const now = dayjs().tz('Asia/Ho_Chi_Minh'); // thời gian hiện tại theo giờ VN
    let start, end;

    switch (range) {
        case "today":
            start = now.startOf("day");
            end = now.endOf("day");
            break;
        case "yesterday":
            start = now.subtract(1, "day").startOf("day");
            end = now.subtract(1, "day").endOf("day");
            break;
        case "this_week":
            start = now.startOf("week");
            end = now.endOf("week");
            break;
        case "last_week":
            start = now.subtract(1, "week").startOf("week");
            end = now.subtract(1, "week").endOf("week");
            break;
        case "this_month":
            start = now.startOf("month");
            end = now.endOf("month");
            break;
        case "last_month":
            start = now.subtract(1, "month").startOf("month");
            end = now.subtract(1, "month").endOf("month");
            break;
        default:
            start = now.startOf("day");
            end = now.endOf("day");
    }

    // Trả về UTC để dùng với MongoDB
    return {
        start: start.toDate(), // tự động chuyển về UTC khi convert sang Date
        end: end.toDate()
    };
}

exports.getStatistics = async (req, res) => {
    try {
        const currentUser = req.user;
        if (!currentUser || currentUser.role !== "admin") {
            return res.status(403).json({ error: 'Chỉ admin mới có quyền sử dụng chức năng này' });
        }

        // Lấy range từ query, mặc định là "today"
        const { napRange = "today", doanhthuRange = "today" } = req.query;
        const napTime = getRange(napRange);
        const doanhthuTime = getRange(doanhthuRange);

        // Tổng số thành viên
        const tonguser = await User.countDocuments();

        // Tổng số dư của người dùng
        const balanceAgg = await User.aggregate([
            { $group: { _id: null, totalBalance: { $sum: "$balance" } } }
        ]);
        const tongtienweb = balanceAgg[0] ? balanceAgg[0].totalBalance : 0;

        // Tổng số đơn đang chạy
        const tongdondangchay = await Order.countDocuments({
            status: { $in: ["running", "In progress", "Processing", "Pending"] }
        });

        // Tổng doanh thu (lợi nhuận) theo từng DomainSmm và theo range
        const revenueAgg = await Order.aggregate([
            {
                $match: {
                    status: { $in: ["running", "In progress", "Processing", "Pending", "Completed"] },
                    createdAt: { $gte: doanhthuTime.start, $lte: doanhthuTime.end }
                }
            },
            {
                $group: { _id: "$DomainSmm", totalLai: { $sum: "$lai" } }
            }
        ]);
        // Tổng lợi nhuận tất cả DomainSmm trong range
        const tongdoanhthu = revenueAgg.reduce((sum, item) => sum + (item.totalLai || 0), 0);

        // Doanh thu theo range
        const revenueRangeAgg = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: doanhthuTime.start, $lte: doanhthuTime.end },
                    status: { $in: ["running", "In progress", "Processing", "Pending", "Completed"] }
                }
            },
            {
                $group: { _id: null, total: { $sum: "$totalCost" } }
            }
        ]);
        const tongdoanhthuhnay = revenueRangeAgg[0] ? revenueRangeAgg[0].total : 0;

        // Tổng số nạp theo range
        const depositRangeAgg = await Deposit.aggregate([
            {
                $match: {
                    createdAt: { $gte: napTime.start, $lte: napTime.end },
                    hanhdong: { $regex: "(nạp tiền|Cộng tiền)", $options: "i" }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$tongtien" }
                }
            }
        ]);
        const tongnapngay = depositRangeAgg[0] ? depositRangeAgg[0].total : 0;

        // Tổng số nạp trong tháng
        const startMonth = moment().startOf("month").toDate();
        const depositMonthAgg = await Deposit.aggregate([
            {
                $match: {
                    createdAt: { $gte: startMonth },
                    hanhdong: { $regex: "(nạp tiền|Cộng tiền)", $options: "i" }
                }
            },
            { $group: { _id: null, totalDepositMonth: { $sum: "$tongtien" } } }
        ]);
        const tongnapthang = depositMonthAgg[0] ? depositMonthAgg[0].totalDepositMonth : 0;

        // Tổng đã nạp: Lấy tổng từ trường tongnap của User
        const userDepositAgg = await User.aggregate([
            { $group: { _id: null, totalDeposited: { $sum: "$tongnap" } } }
        ]);
        const tongdanap = userDepositAgg[0] ? userDepositAgg[0].totalDeposited : 0;

        res.status(200).json({
            tonguser,
            tongtienweb,
            tongdondangchay,
            tongdanap,
            tongdoanhthu,
            laiTheoDomain: revenueAgg, // <-- thêm dòng này
            tongnapthang,
            tongnapngay,
            tongdoanhthuhnay,
            napRange,
            doanhthuRange
        });
    } catch (error) {
        console.error("Lỗi thống kê:", error);
        res.status(500).json({ message: "Lỗi server", error: error.message });
    }
};
