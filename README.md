# Hệ thống Quản lý Nhà thuốc Minh Tiến đạt chuẩn GPP

Web app gồm 3 màn hình: **Bán lẻ quầy POS (FEFO)**, **Nhập kho & Kiểm nhập GPP**, **Danh mục thuốc & Cảnh báo lô/hạn**.

- Backend: Node.js + Express
- CSDL: Microsoft SQL Server (bản Docker hoặc bản cài trên Windows đều chạy được)
- Frontend: HTML / CSS / JavaScript thuần (server tự phục vụ, không cần build)

---

## 1. Cần cài trước

| Phần mềm | Ghi chú |
|---|---|
| [Node.js](https://nodejs.org) bản 18 trở lên (khuyên dùng bản LTS) | Kiểm tra: `node -v` |
| SQL Server **một trong hai cách**: | |
| &nbsp;&nbsp;• SQL Server 2019/2022 (Developer hoặc Express) + SSMS | Cách đa số thành viên dùng |
| &nbsp;&nbsp;• Hoặc Docker Desktop | Xem mục 3B |

---

## 2. Tải code và cài thư viện

```bash
git clone <link-repo>
cd <thư-mục-repo>/code
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

Mở file `.env` vừa tạo và sửa cho đúng máy của bạn (xem mục 3).

---

## 3. Cấu hình SQL Server

> [!IMPORTANT]
> Ứng dụng đăng nhập SQL Server bằng **SQL Server Authentication** (tài khoản + mật khẩu, ví dụ `sa`).
> **Windows Authentication không dùng được** với thư viện Node.js này.

### 3A. SQL Server cài trên Windows (dùng SSMS) — làm 1 lần duy nhất

**Bước 1 – Bật chế độ đăng nhập bằng mật khẩu**
1. Mở SSMS, đăng nhập bằng *Windows Authentication* như bình thường.
2. Chuột phải vào tên server (dòng trên cùng ở Object Explorer) → **Properties** → **Security**.
3. Chọn **SQL Server and Windows Authentication mode** → OK.

**Bước 2 – Bật tài khoản `sa` và đặt mật khẩu**
1. Object Explorer → **Security** → **Logins** → chuột phải `sa` → **Properties**.
2. Trang *General*: nhập mật khẩu mới (ví dụ `Sqlserver123@`), bỏ tích *Enforce password policy* nếu muốn.
3. Trang *Status*: **Login = Enabled** → OK.

   *(Hoặc chạy lệnh: `ALTER LOGIN sa WITH PASSWORD = 'Sqlserver123@'; ALTER LOGIN sa ENABLE;`)*

**Bước 3 – Bật TCP/IP**
1. Mở **SQL Server Configuration Manager** (gõ tìm trong Start, tên kiểu `SQLServerManager16.msc` / `SQLServerManager15.msc`).
2. **SQL Server Network Configuration** → **Protocols for MSSQLSERVER** (hoặc `SQLEXPRESS`) → **TCP/IP** → **Enable**.
3. Nếu là bản **Express**: chuột phải TCP/IP → Properties → tab *IP Addresses* → kéo xuống **IPAll**: xóa ô *TCP Dynamic Ports*, đặt **TCP Port = 1433**.
4. **SQL Server Services** → chuột phải **SQL Server (...)** → **Restart**.

**Bước 4 – Sửa file `.env`**

| Bạn cài bản | Cấu hình trong `.env` |
|---|---|
| Developer / Standard (instance mặc định `MSSQLSERVER`) | `DB_SERVER=localhost`, `DB_PORT=1433`, `DB_INSTANCE=` (để trống) |
| Express đã đặt cổng 1433 ở Bước 3 | Giống dòng trên |
| Express **không** muốn đặt cổng | `DB_INSTANCE=SQLEXPRESS` và bật dịch vụ **SQL Server Browser** trong Configuration Manager |

Luôn sửa `DB_USER` / `DB_PASSWORD` cho khớp tài khoản ở Bước 2.

### 3B. SQL Server chạy bằng Docker

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Sqlserver123@" -p 1433:1433 --name sql1 -d mcr.microsoft.com/mssql/server:2022-latest
```

Những lần sau chỉ cần `docker start sql1`. File `.env` giữ nguyên mặc định là chạy được.

---

## 4. Kiểm tra kết nối

```bash
npm run db:check
```

- Thấy `[OK] Kết nối thành công` là đã kết nối được.
- Nếu báo lỗi, script sẽ in **gợi ý cách sửa** (sai mật khẩu, chưa bật TCP/IP, sai instance...).

---

## 5. Tạo cơ sở dữ liệu + dữ liệu mẫu

Chọn **một** trong hai cách:

**Cách 1 – Bằng lệnh (khuyên dùng, không cần mở SSMS):**
```bash
npm run db:init
```

**Cách 2 – Bằng SSMS:** mở file [`database/00_full_setup_ssms.sql`](database/00_full_setup_ssms.sql) → bấm **Execute (F5)**.
File này đã gộp sẵn tạo bảng + dữ liệu mẫu.

> [!WARNING]
> Cả hai cách đều **XÓA và tạo lại** database `MinhTienPharmacyGPP`. Dữ liệu đã nhập thêm sẽ mất.

---

## 6. Chạy ứng dụng

```bash
npm start
```

Mở trình duyệt: **http://localhost:3000**

| Màn hình | Đường dẫn |
|---|---|
| Bán lẻ quầy POS | http://localhost:3000/screens/ban-le-pos/ban-le-pos.html |
| Nhập kho & Kiểm nhập GPP | http://localhost:3000/screens/nhap-kho-gpp/nhap-kho-gpp.html |
| Danh mục & Cảnh báo lô/hạn | http://localhost:3000/screens/danh-muc-va-canh-bao-han/danh-muc-va-canh-bao-han.html |

### Tài khoản mẫu

| Vai trò | Tên đăng nhập | Mật khẩu | Quyền |
|---|---|---|---|
| Chủ nhà thuốc (admin) | `chunhathuoc` | `ADMIN_123` | Toàn quyền: thêm thuốc/định giá, duyệt nhập kho, xuất hủy |
| Dược sĩ (user) | `duocsi01` | `STAFF_123` | Bán hàng POS, lập phiếu nhập chờ duyệt |
| Dược sĩ (user) | `duocsi02` | `STAFF_456` | Như trên |

Đổi tài khoản ở khung vai trò góc dưới bên trái màn hình.

---

## 7. Các lệnh npm

| Lệnh | Tác dụng |
|---|---|
| `npm start` | Chạy web server |
| `npm run db:check` | Kiểm tra kết nối SQL Server và số dòng dữ liệu |
| `npm run db:init` | Tạo lại database + dữ liệu mẫu |
| `npm run db:bundle` | Tạo lại file `00_full_setup_ssms.sql` sau khi sửa `01_...sql` hoặc `02_...sql` |

---

## 8. Cấu trúc thư mục

```
code/
├── backend/
│   ├── config/db.js          # Kết nối SQL Server (đọc từ .env)
│   ├── routes/               # API cho đăng nhập + 3 màn hình
│   ├── utils/permission.js   # Kiểm tra đăng nhập & quyền admin/user
│   └── server.js
├── database/
│   ├── 00_full_setup_ssms.sql   # File gộp để chạy bằng SSMS (tự sinh)
│   ├── 01_schema_3nf_gpp.sql    # Tạo bảng, view, trigger
│   └── 02_seed_data_test.sql    # Dữ liệu mẫu kiểm thử
├── frontend/                 # Giao diện 3 màn hình
├── scripts/db-tools.js       # Lệnh db:check / db:init / db:bundle
├── .env.example              # Mẫu cấu hình (copy thành .env)
└── package.json
```

---

## 9. Lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| `Login failed for user 'sa'` | Sai mật khẩu trong `.env`, hoặc chưa làm Bước 1–2 mục 3A |
| `Failed to connect ... ECONNREFUSED` / `ETIMEOUT` | Chưa bật TCP/IP (Bước 3), SQL Server chưa chạy, hoặc container Docker đang tắt (`docker start sql1`) |
| `EINSTLOOKUP` | Đặt `DB_INSTANCE=SQLEXPRESS` nhưng chưa bật dịch vụ SQL Server Browser → bật dịch vụ hoặc cố định cổng 1433 |
| `Port 3000 is already in use` | Đổi `PORT=3001` trong `.env` |
| Tiếng Việt bị lỗi font khi chạy SQL bằng SSMS | Dùng file `00_full_setup_ssms.sql` (đã lưu UTF-8 BOM) hoặc dùng `npm run db:init` |
