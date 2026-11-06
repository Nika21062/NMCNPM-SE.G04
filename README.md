# Hệ thống Quản lý Nhà thuốc Minh Tiến đạt chuẩn GPP

Web app gồm 3 màn hình: **Bán lẻ quầy POS (FEFO)**, **Nhập kho & Kiểm nhập GPP**, **Danh mục thuốc & Cảnh báo lô/hạn**.

- Backend: Node.js + Express
- CSDL: Microsoft SQL Server cài trên Windows (quản lý bằng SSMS)
- Frontend: HTML / CSS / JavaScript thuần (server tự phục vụ, không cần build)

---

## Chạy nhanh (3 bước)

```bash
git clone https://github.com/Nika21062/NMCNPM-SE.G04.git
cd NMCNPM-SE.G04
npm install
npm start
```

Lần đầu `npm start` sẽ:
1. Tự tạo file `.env` (cấu hình kết nối).
2. Kết nối thẳng vào SQL Server bằng **Windows Authentication** — giống khi bạn mở SSMS, **không cần tài khoản / mật khẩu**.
3. **Tự tạo database `MinhTienPharmacyGPP` + dữ liệu mẫu** rồi mở web tại **http://localhost:3000**.

Nếu báo lỗi kết nối → chỉ cần sửa **1 dòng `DB_SERVER`** trong file `.env` (xem mục 2) rồi chạy lại `npm start`.

---

## 1. Cần cài trước

| Phần mềm | Ghi chú |
|---|---|
| [Node.js](https://nodejs.org) bản 18 trở lên (khuyên dùng bản LTS) | Kiểm tra: `node -v` |
| SQL Server 2019/2022 (Express hoặc Developer) + SSMS | Đã cài sẵn thì thôi |
| ODBC Driver 17 hoặc 18 for SQL Server | Thường **đã có sẵn** khi cài SQL Server/SSMS. Nếu thiếu: [tải tại đây](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server) |

---

## 2. Sửa tên máy chủ SQL Server (chỉ khi `npm start` báo lỗi kết nối)

1. Mở **SSMS**. Ở cửa sổ **Connect to Server**, nhìn ô **Server name**.
2. Mở file `.env` trong thư mục dự án, sửa dòng `DB_SERVER` thành **y hệt** ô đó:

```ini
DB_AUTH=windows
DB_SERVER=localhost\SQLEXPRESS
```

| Ô "Server name" trong SSMS | Ghi vào `.env` |
|---|---|
| `DESKTOP-ABC123\SQLEXPRESS` | `DB_SERVER=DESKTOP-ABC123\SQLEXPRESS` |
| `localhost\SQLEXPRESS` hoặc `.\SQLEXPRESS` | `DB_SERVER=localhost\SQLEXPRESS` |
| `DESKTOP-ABC123` hoặc `localhost` hoặc `.` | `DB_SERVER=localhost` |

3. Chạy lại `npm start`.

> [!TIP]
> Kiểm tra nhanh kết nối mà không cần mở web: `npm run db:check`

> [!NOTE]
> Windows Authentication kết nối qua đường nội bộ (shared memory) nên **không cần** bật TCP/IP, không cần tài khoản `sa` hay mật khẩu.
> Chỉ cần dịch vụ **SQL Server (SQLEXPRESS)** đang chạy (Win + R → `services.msc`).

---

## 3. Database tự động cập nhật

Mỗi lần `npm start`, hệ thống so sánh "dấu vân tay" của 2 file `database/01_schema_3nf_gpp.sql` và `database/02_seed_data_test.sql` với database đang có:

| Tình huống | Hệ thống tự làm |
|---|---|
| Chưa có database | Tự tạo bảng + dữ liệu mẫu |
| Ai đó sửa file SQL, bạn `git pull` về | Tự tạo lại database theo file mới |
| File SQL không đổi | Giữ nguyên database, chạy luôn |

> [!WARNING]
> Khi tự tạo lại, dữ liệu bạn nhập tay khi test sẽ được thay bằng dữ liệu mẫu.
> Muốn giữ dữ liệu: đặt `DB_AUTO_REBUILD=false` trong `.env` (khi đó tự chạy `npm run db:init` lúc muốn cập nhật).

Muốn chạy SQL bằng tay trong SSMS: mở [`database/00_full_setup_ssms.sql`](database/00_full_setup_ssms.sql) → **Execute (F5)** (file gộp sẵn tạo bảng + dữ liệu mẫu).

---

## 4. Sử dụng

Mở trình duyệt: **http://localhost:3000**

| Màn hình | Đường dẫn |
|---|---|
| Bán lẻ quầy POS | http://localhost:3000/screens/ban-le-pos/ban-le-pos.html |
| Nhập kho & Kiểm nhập GPP | http://localhost:3000/screens/nhap-kho-gpp/nhap-kho-gpp.html |
| Danh mục & Cảnh báo lô/hạn | http://localhost:3000/screens/danh-muc-va-canh-bao-han/danh-muc-va-canh-bao-han.html |

### Tài khoản mẫu (đăng nhập trong web)

| Vai trò | Tên đăng nhập | Mật khẩu | Quyền |
|---|---|---|---|
| Chủ nhà thuốc (admin) | `chunhathuoc` | `ADMIN_123` | Toàn quyền: thêm thuốc/định giá, duyệt nhập kho, xuất hủy |
| Dược sĩ (user) | `duocsi01` | `STAFF_123` | Bán hàng POS, lập phiếu nhập chờ duyệt |
| Dược sĩ (user) | `duocsi02` | `STAFF_456` | Như trên |

Đổi tài khoản ở khung vai trò góc dưới bên trái màn hình.

---

## 5. Các lệnh npm

| Lệnh | Tác dụng |
|---|---|
| `npm start` | Tự tạo/cập nhật database rồi chạy web |
| `npm run db:check` | Kiểm tra kết nối SQL Server và số dòng dữ liệu |
| `npm run db:init` | Ép tạo lại database + dữ liệu mẫu ngay |
| `npm run db:bundle` | Tạo lại file `00_full_setup_ssms.sql` sau khi sửa `01_...sql` hoặc `02_...sql` |

---

## 6. Cấu trúc thư mục

```
├── backend/
│   ├── config/db.js          # Kết nối SQL Server (Windows Authentication, đọc từ .env)
│   ├── config/db-setup.js    # Tự tạo / cập nhật database khi khởi động
│   ├── routes/               # API cho đăng nhập + 3 màn hình
│   ├── utils/permission.js   # Kiểm tra đăng nhập & quyền admin/user
│   └── server.js
├── database/
│   ├── 00_full_setup_ssms.sql   # File gộp để chạy bằng SSMS (tự sinh)
│   ├── 01_schema_3nf_gpp.sql    # Tạo bảng, view, trigger
│   └── 02_seed_data_test.sql    # Dữ liệu mẫu kiểm thử
├── frontend/                 # Giao diện 3 màn hình
├── scripts/db-tools.js       # Lệnh db:check / db:init / db:bundle
├── .env.example              # Mẫu cấu hình (tự copy thành .env)
└── package.json
```

---

## 7. Lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| `Error Locating Server/Instance Specified` | Sai `DB_SERVER` → copy lại đúng ô Server name trong SSMS (mục 2), hoặc dịch vụ SQL Server chưa chạy (`services.msc` → **SQL Server (SQLEXPRESS)** → Start) |
| `Login failed for user 'DESKTOP-...\...'` | Tài khoản Windows đang dùng chưa có quyền trên SQL Server → mở SSMS, vào Security → Logins, thêm tài khoản Windows đó với quyền `sysadmin` |
| `Data source name not found and no default driver` | Thiếu ODBC Driver → cài *ODBC Driver 18 for SQL Server* (link ở mục 1) |
| `Không nạp được driver msnodesqlv8` | Chạy lại `npm install` |
| `Cổng 3000 đang được dùng` | Tắt cửa sổ `npm start` cũ, hoặc đổi `PORT=3001` trong `.env` |
