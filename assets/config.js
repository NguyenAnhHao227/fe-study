/* Cấu hình máy chủ dùng chung (Supabase). Để TRỐNG = app chạy ở chế độ cục bộ:
 * mỗi người tự nhập API key AI trong ⚙ Cài đặt, giải thích chỉ lưu trên trình duyệt đó.
 * Hai giá trị dưới đây là thông tin CÔNG KHAI (an toàn khi đưa lên GitHub): "Project URL" và "anon public key".
 * KHÔNG dán service_role key, API key AI hay mã truy cập vào đây. */
window.FE_CONFIG = {
  supabaseUrl: 'https://rggcfvcmvbfvsmwplcje.supabase.co',
  aiFunction: 'hyper-processor', // tên Edge Function đã deploy trên Supabase (mặc định 'ai')
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnZ2NmdmNtdmJmdnNtd3BsY2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODI0NjUsImV4cCI6MjExMDE1ODQ2NX0.aJIYdLS7dGUh8vo4k8xKtanSZBvPSkEzeAvw0QbT9XA',
};
