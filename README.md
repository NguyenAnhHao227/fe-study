# FE Study — Ôn thi trắc nghiệm FPT

Web ôn thi trắc nghiệm thuần HTML/CSS/JS (không backend, không build), chạy được trên **GitHub Pages**.

## Tính năng
- Chọn hồ sơ kiểu "chọn tài khoản" (ô **+** để thêm tên). Tiến độ lưu riêng từng người.
- 5 môn: CSI106, CEA201, MAE101, PRF192, SSA101 — hiện tổng số câu và số câu từng môn.
- Tạo đề tuỳ chỉnh: số câu / thời gian (mặc định 50 câu / 60', CSI106: 60 câu / 60'), chủ đề, nguồn câu hỏi (mới / sai / đánh dấu / tất cả), trộn câu, trộn đáp án.
- **Câu đã làm không bị lặp lại** ở đề mới; **câu sai** gom vào hộp riêng để ôn lại (làm đúng thì ra khỏi hộp).
- Chọn đáp án là hiện đúng/sai + giải thích ngay. Nút **VI** hiện bản dịch tiếng Việt nhỏ gọn bên dưới tiếng Anh.
- **Giải thích bằng AI** (Anthropic / OpenAI-compatible / Gemini): lưu lại, người sau gặp lại câu đó dùng luôn, không gọi AI nữa.
- Tổng kết điểm mỗi phiên (thang 10), theo chủ đề, xem lại từng câu, lịch sử các phiên, làm tiếp bài dở dang.
- Phím tắt: `1-8` chọn đáp án, `←/→` chuyển câu, `V` dịch, `M` đánh dấu xem lại.

## Chạy thử
Mở `index.html` bằng trình duyệt, hoặc chạy server tĩnh:
```bash
python -m http.server 8000
```

## Đưa lên GitHub Pages
Push cả thư mục này lên repo → Settings → Pages → Deploy from branch → `main` / root. Mọi đường dẫn là tương đối nên chạy được ở `https://<user>.github.io/<repo>/`.

## Nạp câu hỏi
- CSI106 hiện đã nạp đủ **550 câu + 5 đề mô phỏng**. Tạo lại từ file docx (thêm `--per-topic 8` để lấy bản test nhỏ):
  ```bash
  node tools/build-bank.js "<đường dẫn>/CSI106_Ngan_hang_cau_hoi_On_thi.docx" CSI106
  ```
- Môn khác: bấm vào môn → **Nhập ngân hàng câu hỏi** (`.docx`/`.txt`/`.json`), hoặc chạy `build-bank.js` với mã môn khác rồi thêm `<script src="data/<mã>.js">` vào `index.html`.
- Định dạng file: `Question N: [ID: …] …`, các dòng `A. …`, `Answer: B`, `Explanation: …`, dòng `Vietnamese: …` ngay dưới mỗi mục để có bản dịch.

## Lưu ý khi đưa lên GitHub
- **Dữ liệu người dùng nằm trong trình duyệt** (IndexedDB) của từng máy. Hồ sơ và "giải thích đã lưu" **không tự đồng bộ giữa các máy**. Có 2 cách chia sẻ:
  - ⚙ Cài đặt → Sao lưu / Nhập sao lưu (chuyển tiến độ giữa các máy).
  - ⚙ Cài đặt → *Xuất giải thích AI cho GitHub* → thay `data/explanations.js` → commit. Từ đó mọi người mở trang đều có sẵn các giải thích đó.
  - Muốn đồng bộ tự động thật sự cần backend (Firebase/Supabase…) — chưa làm.
- **API key** chỉ lưu trong trình duyệt người dùng, không nằm trong mã nguồn. Mỗi người tự nhập key của mình.
- Repo công khai = ngân hàng câu hỏi (`data/*.js`) công khai. Cân nhắc để repo private hoặc bản quyền đề thi.
