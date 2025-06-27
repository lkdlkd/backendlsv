// const axios = require("axios");

// /**
//  * Controller xử lý chuyển đổi link thành UID.
//  * @param {Request} req 
//  * @param {Response} res 
//  */
// exports.getUid = async (req, res) => {
//   const { link } = req.body;
//   // Kiểm tra xem link có được gửi lên hay không
//   if (!link) {
//     return res.status(400).json({
//       status: "error",
//       message: "Link is required",
//     });
//   }

//   // Kiểm tra tính hợp lệ của URL
//   try {
//     new URL(link);
//   } catch (error) {
//     return res.status(400).json({
//       status: "error",
//       message: "Invalid URL",
//     });
//   }

//   // Cấu hình headers giống như phiên bản PHP
//   const headers = {
//     "accept": "application/json, text/javascript, */*; q=0.01",
//     "accept-language": "vi,en;q=0.9,en-GB;q=0.8,en-US;q=0.7",
//     "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
//     "origin": "https://id.traodoisub.com",
//     "priority": "u=1, i",
//     "referer": "https://id.traodoisub.com/",
//     "sec-ch-ua": `"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"`,
//     "sec-ch-ua-mobile": "?0",
//     "sec-ch-ua-platform": `"Windows"`,
//     "sec-fetch-dest": "empty",
//     "sec-fetch-mode": "cors",
//     "sec-fetch-site": "same-origin",
//     "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
//     "x-requested-with": "XMLHttpRequest"
//   };

//   // Tạo body dạng URL-encoded
//   const data = new URLSearchParams();
//   data.append("link", link);

//   try {
//     const response = await axios.post(
//       "https://id.traodoisub.com/api.php",
//       data.toString(),
//       { headers }
//     );

//     const responseData = response.data;
//     // Nếu API trả về thành công (success == 200)
//     if (responseData.success && responseData.success == 200) {
//       return res.json({
//         status: "success",
//         uid: responseData.id,
//       });
//     } else {
//       return res.status(400).json({
//         status: "error",
//         message: "Không thể lấy UID",
//       });
//     }
//   } catch (error) {
//     console.error("Error calling external API:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Internal server error",
//     });
//   }
// };
const axios = require("axios");

exports.getUid = async (req, res) => {
  const { link } = req.body;
  if (!link) {
    return res.status(400).json({
      status: "error",
      message: "Link is required",
    });
  }
  try {
    var raw = `{\r\n  \"url\": \"${link}\"\r\n}`;

    var requestOptions = {
      method: 'POST',
      body: raw,
      redirect: 'follow'
    };

    fetch("https://likenhanh.pro/api/get_uid", requestOptions)
      .then(response => response.text())
      .then(result => {
        const responseData = JSON.parse(result);
        if (responseData && responseData.uid) {
          return res.json({
            status: "success",
            uid: responseData.uid,
          });
        } else {
          return res.status(400).json({
            status: "error",
            message: "Không thể lấy UID",
          });
        }
      })
      .catch(error => {
        console.log('error', error);
        return res.status(500).json({
          status: "error",
          message: "Internal server error",
        });
      });
  } catch (error) {
    console.error("Error calling like5s API:", error?.response?.data || error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};