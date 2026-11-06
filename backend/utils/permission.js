/* ============================================================================
   TIỆN ÍCH KIỂM TRA NGƯỜI DÙNG & PHÂN QUYỀN ADMIN / USER (permission.js)
   Chức năng: Xác minh userId gửi lên có tồn tại, đang ACTIVE và có đúng cờ quyền
   trong bảng tbl_vai_tro hay không. Không dùng giá trị mặc định cho userId.
   ============================================================================ */

const { sql } = require('../config/db');

/* Hàm tạo lỗi kèm mã HTTP để route trả về đúng status (401/403) */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* Hàm requireUser: Lấy thông tin người dùng + quyền từ CSDL.
   - transaction: sql.Transaction hoặc ConnectionPool đang dùng
   - userId: mã người dùng client gửi lên (bắt buộc)
   - permFlag: tên cột quyền cần kiểm tra ('cho_phep_sua_gia' | 'cho_phep_duyet_kho' | 'cho_phep_xem_doanh_thu'), bỏ trống nếu chỉ cần đăng nhập
   - actionName: mô tả thao tác để hiển thị thông báo lỗi */
async function requireUser(transaction, userId, permFlag = null, actionName = 'thực hiện thao tác này') {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(401, 'Chưa đăng nhập: Vui lòng đăng nhập tài khoản trước khi thực hiện thao tác!');
  }

  const result = await new sql.Request(transaction)
    .input('ma_nd', sql.Int, id)
    .query(`
      SELECT u.ma_nguoi_dung, u.ho_va_ten, u.trang_thai, u.ma_vai_tro,
             v.ten_vai_tro, v.cho_phep_sua_gia, v.cho_phep_duyet_kho, v.cho_phep_xem_doanh_thu
      FROM tbl_nguoi_dung u
      INNER JOIN tbl_vai_tro v ON u.ma_vai_tro = v.ma_vai_tro
      WHERE u.ma_nguoi_dung = @ma_nd;
    `);

  const user = result.recordset[0];
  if (!user) {
    throw httpError(403, 'Từ chối truy cập: Tài khoản không tồn tại trong hệ thống!');
  }
  if (user.trang_thai !== 'ACTIVE') {
    throw httpError(403, `Từ chối truy cập: Tài khoản "${user.ho_va_ten}" đang bị khóa!`);
  }
  if (permFlag && !user[permFlag]) {
    throw httpError(403, `Từ chối truy cập (RBAC): Vai trò "${user.ten_vai_tro}" không có quyền ${actionName}!`);
  }
  return user;
}

module.exports = { requireUser, httpError };
