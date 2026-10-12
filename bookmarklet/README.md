# Bookmarklet "Copy lịch EMC" (Evergreen – ShipmentLink)

Bấm 1 nút trên trang kết quả ShipmentLink → lịch được copy đúng 17 cột của sheet **MAU_NHAP** → dán → 📋 Nhập. Không cần AI, không cần chụp ảnh.

## Cài (1 lần, mỗi người trong team)
1. Mở file `evergreen.bookmarklet.txt`, bấm **Ctrl + A** rồi **Ctrl + C** (copy toàn bộ, bắt đầu bằng `javascript:`).
2. Trong Chrome bấm **Ctrl + Shift + B** để hiện thanh dấu trang (nếu chưa hiện).
3. Chuột phải lên thanh dấu trang → **Add page…** (Thêm trang).
4. **Name**: `Copy lịch EMC` · **URL**: dán (Ctrl + V) → **Save**.

## Dùng
1. ShipmentLink → **Sailing Schedules → Search by Point** → nhập POL/POD → ra trang kết quả.
2. Bấm bookmark **Copy lịch EMC** → hiện thông báo "Đã copy N chuyến".
3. Sổ tay → sheet **MAU_NHAP** → bấm ô **A2** → **Ctrl + V**.
4. Menu **🚢 Lịch tàu → 📋 Nhập từ sheet MAU_NHAP**.

## Lấy được gì
| Trên ShipmentLink | Cột MAU_NHAP |
|---|---|
| Service, Vessel Voyage | Service, Vessel, Voyage |
| Port of Loading / Discharge | POL / POD (mã UN/LOCODE) |
| Port Cut Off Date | Port (CY) cut-off |
| VGM via EDI/WEB/APP (không có thì VGM giấy) | VGM cut-off |
| Departure Date (POL) / Arrival Date (POD) | ETD / ETA |
| Routing Details (bảng ẩn trong trang) | Direct hoặc T/S, Cảng T/S, Ghi chú "Nối tàu …" |

Trang không có Booking cut-off, SI cut-off và terminal → để trống.
Cảng chưa có trong bảng mã → ghi tên cảng + "kiểm tra mã cảng" ở Ghi chú.

## Cho người sửa code
- Mã nguồn dễ đọc: `evergreen.js`. Sau khi sửa: `node bookmarklet/build.js` để tạo lại `evergreen.bookmarklet.txt`.
- Kiểm thử (Chromium + Playwright, trên trang đã lưu `test/fixtures/emc_hph_sin.html`):
  `node bookmarklet/test/test_evergreen.js`
