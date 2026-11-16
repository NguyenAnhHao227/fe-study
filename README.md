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
- Hiện đã nạp **1.873 câu**: CSI106 946, CEA201 318, PRF192 252, SSA101 357. **MAE101 chưa có dữ liệu** (nhập bằng nút trong app hoặc `build-bank.js`).
- Dữ liệu được chuyển đổi từ thư mục nguồn `Nguon_de_thi_on_tap_5_mon_FE` (không đưa lên GitHub) bằng:
  ```bash
  node tools/convert-quiz-js.js
  ```
  Lệnh này ghi đè `data/csi106.js`, `cea201.js`, `prf192.js`, `ssa101.js`; tự bỏ câu trùng và giữ câu nhiều đáp án.
- Lời giải thích gốc có ghi "Đáp án B…": app tự đổi chữ cái cho khớp thứ tự đáp án đang bị trộn.
- Từ file `.docx` theo định dạng bên dưới: `node tools/build-bank.js "<file.docx>" <MÃ_MÔN>` (thêm `--per-topic 8` để lấy bản test nhỏ).
- Môn khác: bấm vào môn → **Nhập ngân hàng câu hỏi** (`.docx`/`.txt`/`.json`), hoặc chạy `build-bank.js` với mã môn khác rồi thêm `<script src="data/<mã>.js">` vào `index.html`.
- Định dạng file: `Question N: [ID: …] …`, các dòng `A. …`, `Answer: B`, `Explanation: …`, dòng `Vietnamese: …` ngay dưới mỗi mục để có bản dịch.

## Bản dịch tiếng Việt (tự động + dịch hàng loạt)

Nút **VI** hiện bản dịch nhỏ dưới tiếng Anh. Với câu thiếu bản dịch, AI **tự dịch đúng phần còn thiếu**:
- Chỉ dịch cái thiếu: nếu đã có dịch câu hỏi mà thiếu đáp án thì chỉ gửi các đáp án thiếu. Câu đã đủ dịch thì **không gọi AI**. Bỏ qua số, mẫu bit, công thức, mã, và văn bản đã là tiếng Việt.
- Gộp tối đa 4 câu mỗi lần gọi, dịch trước câu đang làm và 4 câu kế tiếp nên chuyển câu không phải chờ.
- Dịch xong **lưu lại** (dùng chung khi bật Supabase, hoặc lưu trên máy nếu tự nhập API key) nên không dịch lại.
- Định dạng trao đổi với AI là văn bản có nhãn (`[Q1]` / `T:` / `A:`), không dùng JSON nên không còn lỗi "không đúng định dạng".
- Tắt nút VI thì không gọi AI. Gặp lỗi (hết lượt, sai mã) thì tạm dừng 2 phút và hiện nút để thử lại.

**Dịch hàng loạt một lần** (khuyên dùng, để mọi người có bản dịch sẵn, không tốn lượt AI lúc dùng): chạy trên máy bạn, ghi thẳng bản dịch vào `data/*.js`. API key đặt qua biến môi trường, **không** ghi vào file.
```powershell
$env:AI_BASE  = "https://api.xah.io/v1"
$env:AI_KEY   = "sk-..."
$env:AI_MODEL = "tên-model-không-thinking"
node tools/translate-bank.js --dry                      # chỉ đếm, không gọi AI
node tools/translate-bank.js --only CEA201 --limit 20   # thử 20 câu trước, kiểm tra chất lượng
node tools/translate-bank.js                            # dịch toàn bộ phần còn thiếu
```
Chạy lại hoặc ngắt (Ctrl+C) lúc nào cũng được, lần sau chỉ dịch phần còn lại. Dịch xong nhớ `git commit` và `git push`.

## AI dùng chung + giải thích dùng chung (Supabase, tuỳ chọn)

Mặc định mỗi người tự nhập API key AI trong ⚙ Cài đặt và giải thích chỉ lưu trong trình duyệt của người đó. Bật Supabase (miễn phí) để:
- **API key AI nằm ở máy chủ** (Edge Function), không ai thấy được. Người dùng chỉ nhập một **mã truy cập** (một lần mỗi trình duyệt) là dùng được AI.
- **Giải thích + bản dịch AI lưu chung**: ai bấm trước thì mọi người sau dùng lại trên **mọi máy**, không tốn thêm lượt AI. Chỉ xem giải thích đã có thì **không cần mã**.
- **Giới hạn lượt AI**: mỗi thiết bị tối đa 50 lượt/ngày và toàn hệ thống 300 lượt/ngày (đổi được).
- Hồ sơ và tiến độ vẫn nằm trong trình duyệt từng máy, không mật khẩu, không đồng bộ.

Cài đặt (làm một lần):
1. Tạo project tại https://supabase.com (gói Free).
2. **SQL Editor** → dán toàn bộ `supabase/schema.sql` → Run.
3. **Edge Functions** → tạo function tên `ai`, dán nội dung `supabase/functions/ai/index.ts`, Deploy. (Nếu function có tên khác, ví dụ tên mặc định do Supabase đặt, khai báo tên đó ở `aiFunction` trong `assets/config.js`.)
4. **Edge Functions → Secrets** thêm 4 secret: `AI_BASE` (vd `https://api.xah.io/v1`), `AI_KEY` (API key AI), `AI_MODEL` (vd `deepseek-4.1-flash-ckey`), `ACCESS_CODE` (mã truy cập bạn tự đặt, nên dài từ 8 ký tự).
5. **Project Settings → API**: lấy **Project URL** và **anon public key** → điền vào `assets/config.js` (hai giá trị này công khai, an toàn khi commit).
6. Commit & push. Gửi mã truy cập cho bạn bè; đổi mã bằng cách sửa secret `ACCESS_CODE`.

Đổi giới hạn lượt AI (SQL Editor):
```sql
update app_config set value = '30'  where key = 'ai_device_limit';
update app_config set value = '200' where key = 'ai_global_limit';
```
Để trống `assets/config.js` thì app quay về chế độ cục bộ như cũ.

## Thống kê sử dụng (trang quản trị `admin.html`)

Mở `https://<user>.github.io/<repo>/admin.html` và nhập **mật khẩu quản trị** để xem: tổng thiết bị đã dùng, hoạt động hôm nay / 7 ngày, thiết bị mới và quay lại, biểu đồ 14 ngày, thống kê **theo môn** (thiết bị đã mở, bài đã nộp, câu đã trả lời), số giải thích đã lưu và lượt AI (kèm chi phí ước tính).

- Đếm theo **thiết bị/trình duyệt** bằng một mã ngẫu nhiên, **không lưu tên, không lưu IP**. Một người dùng 2 máy tính là 2.
- Trang `admin.html` không có liên kết nào trỏ tới; mật khẩu được kiểm tra **ở máy chủ** (secret `ADMIN_CODE`), nên không biết mật khẩu thì không xem được số liệu.
- Cài đặt: chạy lại `supabase/schema.sql` (thêm 2 bảng + 2 hàm), deploy lại function, thêm secret `ADMIN_CODE` (đặt khác `ACCESS_CODE`).

## Lưu ý khi đưa lên GitHub
- **Dữ liệu người dùng nằm trong trình duyệt** (IndexedDB) của từng máy. Hồ sơ và "giải thích đã lưu" **không tự đồng bộ giữa các máy**. Có 2 cách chia sẻ:
  - ⚙ Cài đặt → Sao lưu / Nhập sao lưu (chuyển tiến độ giữa các máy).
  - ⚙ Cài đặt → *Xuất giải thích AI cho GitHub* → thay `data/explanations.js` → commit. Từ đó mọi người mở trang đều có sẵn các giải thích đó.
  - Muốn đồng bộ tự động thật sự cần backend (Firebase/Supabase…) — chưa làm.
- **API key** chỉ lưu trong trình duyệt người dùng, không nằm trong mã nguồn. Mỗi người tự nhập key của mình.
- Repo công khai = ngân hàng câu hỏi (`data/*.js`) công khai. Cân nhắc để repo private hoặc bản quyền đề thi.
