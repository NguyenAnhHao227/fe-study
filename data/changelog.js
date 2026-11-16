/* Lịch sử cập nhật hiển thị ở thông báo "Có gì mới" và nút chuông 🔔 góc trên bên phải.
 *
 * Mỗi lần cập nhật: thêm MỘT mục lên ĐẦU danh sách (mục mới nhất ở trên cùng).
 *   id    : mã duy nhất, không trùng với mục khác (dùng để nhớ ai đã đọc), ví dụ "2026-11-20-ten-ngan".
 *   title : tiêu đề ngắn.   date: ngày hiển thị.
 *   items : danh sách ý, mỗi ý có icon (emoji) và text. Viết ngắn, dễ hiểu, tránh thuật ngữ.
 * Thêm mục mới => mọi người sẽ thấy thông báo lớn đúng MỘT lần, rồi chuông chỉ còn là lịch sử.
 */
window.CHANGELOG = [
  {
    id: '2026-11-16-de-giang-vien',
    title: 'CEA201: thêm đề của giảng viên',
    date: '16/11/2026',
    items: [
      { icon: '👨‍🏫', text: 'CEA201 có thêm 200 câu ôn tập do giảng viên gửi, đã có sẵn bản dịch tiếng Việt.' },
      { icon: '📚', text: 'Bấm vào CEA201 sẽ chọn mục trước: Đề của giảng viên hoặc Đề cũ. Tiến độ và câu sai tính riêng cho từng mục.' },
    ],
  },
  {
    id: '2026-11-16-dich-ai',
    title: 'Dịch tiếng Việt thông minh hơn',
    date: '16/11/2026',
    items: [
      { icon: '🌐', text: 'AI tự động dịch những phần còn thiếu của câu hỏi và đáp án. Câu nào đã đủ bản dịch thì không gọi AI nữa.' },
      { icon: '🎯', text: 'Chỉ dịch đúng chỗ thiếu: nếu đã có dịch câu hỏi mà thiếu đáp án thì chỉ dịch các đáp án đó, giữ nguyên bản dịch sẵn có.' },
      { icon: '⚡', text: 'Các câu sắp tới được dịch trước nên chuyển câu không phải chờ. Bản dịch được lưu lại cho lần sau.' },
      { icon: '🔔', text: 'Có thêm thông báo cập nhật này. Bấm chuông 🔔 ở góc trên bên phải để xem lại bất cứ lúc nào.' },
    ],
  },
  {
    id: '2026-11-14-ngan-hang',
    title: 'Ngân hàng câu hỏi mới: 1.873 câu',
    date: '14/11/2026',
    items: [
      { icon: '📚', text: 'Cập nhật toàn bộ ngân hàng: CSI106 946 câu, CEA201 318 câu, PRF192 252 câu, SSA101 357 câu. MAE101 hiện chưa có câu hỏi.' },
      { icon: '🧠', text: 'CSI106 có giải thích dài, rõ ràng theo từng chương. Hỗ trợ cả câu chọn nhiều đáp án.' },
      { icon: '🔀', text: 'Khi đáp án bị trộn thứ tự, lời giải tự đổi chữ A/B/C/D cho khớp với những gì bạn đang thấy.' },
      { icon: '♻️', text: 'Ngân hàng cũ đã được thay thế, nên tiến độ "đã làm" trước đây không còn áp dụng cho bộ câu mới.' },
    ],
  },
  {
    id: '2026-11-14-ai-chung',
    title: 'AI giải thích dùng chung',
    date: '14/11/2026',
    items: [
      { icon: '✨', text: 'Bấm "Giải thích chi tiết bằng AI" để xem phân tích từng đáp án. Giải thích được lưu chung: ai bấm trước thì người sau xem lại ngay, không tốn lượt.' },
      { icon: '🔑', text: 'Lần đầu tạo giải thích mới cần mã truy cập (hỏi người quản lý trang). Chỉ xem giải thích đã có thì không cần mã.' },
      { icon: '📊', text: 'Có thống kê ẩn danh để biết số thiết bị đang dùng. Không lưu tên hay thông tin cá nhân.' },
    ],
  },
  {
    id: '2026-11-13-ra-mat',
    title: 'Ra mắt FE Study',
    date: '13/11/2026',
    items: [
      { icon: '👤', text: 'Chọn hồ sơ bằng tên của bạn. Tiến độ, câu sai và lịch sử làm bài được lưu riêng trên máy bạn.' },
      { icon: '📝', text: 'Tạo đề tuỳ chỉnh theo số câu, thời gian và chủ đề; chọn đáp án là hiện đúng sai và giải thích ngay.' },
      { icon: '🔁', text: 'Câu đã làm không lặp lại ở đề mới; câu sai được gom riêng để ôn lại. Có thể đánh dấu câu hay để xem sau.' },
      { icon: '🇻🇳', text: 'Nút VI hiện bản dịch tiếng Việt nhỏ gọn bên dưới tiếng Anh; sau mỗi bài có tổng kết điểm và xem lại từng câu.' },
    ],
  },
];
