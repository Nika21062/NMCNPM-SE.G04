/* ============================================================================
   MÁY CHỦ BACKEND EXPRESSJS - HỆ THỐNG NHÀ THUỐC MINH TIẾN ĐẠT CHUẨN GPP
   Chức năng: Khởi tạo Web Server, phục vụ giao diện tĩnh và định tuyến REST API
   ============================================================================ */

const express = require('express');
const cors = require('cors');
const path = require('path');

/* Nhập 4 module định tuyến API tương ứng với Xác thực RBAC và 3 màn hình nghiệp vụ */
const authRoutes = require('./routes/auth.routes');
const banLePosRoutes = require('./routes/ban-le-pos.routes');
const nhapKhoRoutes = require('./routes/nhap-kho-gpp.routes');
const danhMucRoutes = require('./routes/danh-muc-va-canh-bao-han.routes');

const app = express();
const PORT = process.env.PORT || 3000;

/* Cấu hình Middleware cho phép CORS, đọc dữ liệu JSON và tắt hoàn toàn bộ nhớ đệm (Cache) để luôn lấy dữ liệu mới nhất từ SQL Server */
app.set('etag', false);
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

/* Phục vụ tĩnh toàn bộ các file HTML, CSS, JS trong thư mục frontend và thư mục gốc code */
app.use(express.static(path.join(__dirname, '../frontend'), { etag: false, lastModified: false, maxAge: 0 }));
app.use(express.static(path.join(__dirname, '..'), { etag: false, lastModified: false, maxAge: 0 }));

/* Định tuyến các nhóm API kết nối trực tiếp tới SQL Server */
app.use('/api/auth', authRoutes);
app.use('/api/ban-le-pos', banLePosRoutes);
app.use('/api/nhap-kho-gpp', nhapKhoRoutes);
app.use('/api/danh-muc-va-canh-bao-han', danhMucRoutes);

/* Hàm điều hướng trang gốc (/) mặc định vào Màn hình 1: Bán lẻ Quầy POS theo thiết kế mới */
app.get('/', (req, res) => {
  res.redirect('/screens/ban-le-pos/ban-le-pos.html');
});

/* Khởi động: tự tạo / cập nhật CSDL trên SQL Server trước, sau đó mới mở cổng HTTP */
const { ensureDatabase, explainError } = require('./config/db-setup');

async function startServer() {
  try {
    await ensureDatabase();
  } catch (err) {
    explainError(err);
    console.error('[DB] Không thể khởi tạo CSDL -> web vẫn chạy nhưng các API sẽ báo lỗi cho tới khi kết nối được SQL Server.\n');
  }

  const server = app.listen(PORT, () => {
    console.log(`======================================================================`);
    console.log(`HỆ THỐNG NHÀ THUỐC MINH TIẾN GPP ĐANG CHẠY TẠI: http://localhost:${PORT}`);
    console.log(`1. Màn 1 - Bán lẻ Quầy POS (FEFO)   : http://localhost:${PORT}/screens/ban-le-pos/ban-le-pos.html`);
    console.log(`2. Màn 2 - Nhập kho & Kiểm nhập GPP : http://localhost:${PORT}/screens/nhap-kho-gpp/nhap-kho-gpp.html`);
    console.log(`3. Màn 3 - Thuốc & Cảnh báo Lô/Hạn  : http://localhost:${PORT}/screens/danh-muc-va-canh-bao-han/danh-muc-va-canh-bao-han.html`);
    console.log(`======================================================================`);
  });

  /* Báo lỗi dễ hiểu khi cổng đã bị chương trình khác (hoặc một cửa sổ npm start khác) chiếm */
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[SERVER] Cổng ${PORT} đang được dùng (có thể bạn đã mở "npm start" ở cửa sổ khác).`);
      console.error('         Tắt cửa sổ đó, hoặc đổi PORT=3001 trong file .env rồi chạy lại.\n');
      process.exit(1);
    }
    throw err;
  });
}

startServer();
