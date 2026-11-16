# Dịch hàng loạt phần còn thiếu trong data/*.js. Hỏi API key an toàn: gõ vào KHÔNG hiện lên màn hình và KHÔNG lưu ở đâu.
#
# Chạy (trong thư mục dự án):
#   powershell -ExecutionPolicy Bypass -File tools\dich-hang-loat.ps1 -Dry                     # chỉ đếm, không gọi AI
#   powershell -ExecutionPolicy Bypass -File tools\dich-hang-loat.ps1 -Only CEA201 -Limit 20   # thử 20 câu
#   powershell -ExecutionPolicy Bypass -File tools\dich-hang-loat.ps1                          # dịch toàn bộ phần còn thiếu
param(
  [string]$Only = "",   # chỉ một môn, ví dụ CEA201
  [int]$Limit = 0,      # chỉ N câu đầu tiên còn thiếu
  [switch]$Dry          # chỉ đếm, không gọi AI
)

Set-Location (Join-Path $PSScriptRoot "..")

if ($Dry) {
  node tools/translate-bank.js --dry
  exit $LASTEXITCODE
}

$defBase  = "https://api.xah.io/v1"
$defModel = "tranhieu13102003/deepseek-v4.1-flash"

$base = Read-Host "Địa chỉ API (Enter = $defBase)"
if ([string]::IsNullOrWhiteSpace($base)) { $base = $defBase }
$model = Read-Host "Tên model (Enter = $defModel)"
if ([string]::IsNullOrWhiteSpace($model)) { $model = $defModel }
$secure = Read-Host "Dán API key rồi nhấn Enter (sẽ không hiện ra)" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ([string]::IsNullOrWhiteSpace($key)) { Write-Host "Chưa nhập API key, dừng lại."; exit 1 }

# Biến môi trường chỉ tồn tại trong cửa sổ này và mất khi đóng cửa sổ.
$env:AI_BASE  = $base
$env:AI_MODEL = $model
$env:AI_KEY   = $key

$nodeArgs = @()
if ($Only)  { $nodeArgs += @("--only", $Only) }
if ($Limit) { $nodeArgs += @("--limit", "$Limit") }

Write-Host ""
Write-Host "Model: $model | API: $base"
node tools/translate-bank.js @nodeArgs
$code = $LASTEXITCODE

# Xoá key khỏi bộ nhớ của cửa sổ này ngay khi xong.
Remove-Item Env:AI_KEY -ErrorAction SilentlyContinue
$key = $null
exit $code
