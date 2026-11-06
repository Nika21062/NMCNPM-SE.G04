/* ============================================================================
   API ĐỊNH TUYẾN XÁC THỰC TÀI KHOẢN & PHÂN QUYỀN RBAC THEO CSDL
   File: backend/routes/auth.routes.js
   Chức năng: Truy vấn trực tiếp bảng tbl_vai_tro và tbl_nguoi_dung trên SQL Server,
   xác thực tên đăng nhập + mật khẩu khi chuyển đổi vai trò ở góc dưới bên trái
   ============================================================================ */

const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');

/* Hàm API GET /roles: Lấy danh sách vai trò từ tbl_vai_tro và thông tin người dùng hiện tại từ tbl_nguoi_dung */
router.get('/roles', async (req, res) => {
  try {
    const pool = await getPool();
    const userId = Number(req.query.userId || 0);
    const roleId = (req.query.roleId || '').trim();

    /* Truy vấn toàn bộ danh sách vai trò và quyền hạn từ bảng tbl_vai_tro */
    const rolesRes = await pool.request().query(`
      SELECT ma_vai_tro, ten_vai_tro, cho_phep_sua_gia, cho_phep_duyet_kho, cho_phep_xem_doanh_thu, mo_ta_quyen
      FROM tbl_vai_tro
      ORDER BY ma_vai_tro ASC;
    `);

    const roles = rolesRes.recordset.map(r => ({
      roleId: r.ma_vai_tro,
      roleName: r.ten_vai_tro,
      canEditPrice: Boolean(r.cho_phep_sua_gia),
      canApproveStock: Boolean(r.cho_phep_duyet_kho),
      canViewRevenue: Boolean(r.cho_phep_xem_doanh_thu),
      description: r.mo_ta_quyen || ''
    }));

    /* Truy vấn tài khoản người dùng đang đăng nhập từ bảng tbl_nguoi_dung kết hợp tbl_vai_tro */
    const userReq = pool.request();
    let userQuery = `
      SELECT TOP 1
        u.ma_nguoi_dung, u.ten_dang_nhap, u.ho_va_ten, u.so_dien_thoai, u.ma_vai_tro, u.trang_thai,
        v.ten_vai_tro, v.cho_phep_sua_gia, v.cho_phep_duyet_kho, v.cho_phep_xem_doanh_thu, v.mo_ta_quyen
      FROM tbl_nguoi_dung u
      INNER JOIN tbl_vai_tro v ON u.ma_vai_tro = v.ma_vai_tro
      WHERE ISNULL(u.trang_thai, 'ACTIVE') = 'ACTIVE'
    `;

    if (userId > 0) {
      userReq.input('ma_nd', sql.Int, userId);
      userQuery += ` AND u.ma_nguoi_dung = @ma_nd `;
    } else if (roleId) {
      userReq.input('ma_vt', sql.VarChar(20), roleId);
      userQuery += ` AND u.ma_vai_tro = @ma_vt `;
    } else {
      userQuery += ` AND u.ma_vai_tro = 'ACT-02' `;
    }
    userQuery += ` ORDER BY u.ma_nguoi_dung ASC; `;

    let userRes = await userReq.query(userQuery);
    if (userRes.recordset.length === 0) {
      userRes = await pool.request().query(`
        SELECT TOP 1
          u.ma_nguoi_dung, u.ten_dang_nhap, u.ho_va_ten, u.so_dien_thoai, u.ma_vai_tro, u.trang_thai,
          v.ten_vai_tro, v.cho_phep_sua_gia, v.cho_phep_duyet_kho, v.cho_phep_xem_doanh_thu, v.mo_ta_quyen
        FROM tbl_nguoi_dung u
        INNER JOIN tbl_vai_tro v ON u.ma_vai_tro = v.ma_vai_tro
        WHERE ISNULL(u.trang_thai, 'ACTIVE') = 'ACTIVE'
        ORDER BY u.ma_nguoi_dung ASC;
      `);
    }

    const u = userRes.recordset[0];
    const currentUser = u ? {
      userId: u.ma_nguoi_dung,
      username: u.ten_dang_nhap,
      fullName: u.ho_va_ten,
      phone: u.so_dien_thoai,
      roleId: u.ma_vai_tro,
      roleName: u.ten_vai_tro,
      canEditPrice: Boolean(u.cho_phep_sua_gia),
      canApproveStock: Boolean(u.cho_phep_duyet_kho),
      canViewRevenue: Boolean(u.cho_phep_xem_doanh_thu),
      status: u.trang_thai
    } : null;

    res.json({ ok: true, roles, currentUser });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* Hàm API POST /login: Xác thực tên đăng nhập và mật khẩu theo đúng vai trò chọn từ bảng tbl_nguoi_dung */
router.post('/login', async (req, res) => {
  const { roleId, username, password } = req.body;
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '').trim();
  const cleanRole = String(roleId || '').trim();

  if (!cleanUser || !cleanPass) {
    return res.status(400).json({
      ok: false,
      message: 'Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!'
    });
  }

  try {
    const pool = await getPool();

    /* Kiểm tra thông tin tài khoản trên bảng tbl_nguoi_dung kết hợp tbl_vai_tro */
    const userRes = await pool.request()
      .input('ten_dang_nhap', sql.VarChar(50), cleanUser)
      .query(`
        SELECT TOP 1
          u.ma_nguoi_dung, u.ten_dang_nhap, u.mat_khau_hash, u.ho_va_ten,
          u.so_dien_thoai, u.ma_vai_tro, u.trang_thai,
          v.ten_vai_tro, v.cho_phep_sua_gia, v.cho_phep_duyet_kho, v.cho_phep_xem_doanh_thu
        FROM tbl_nguoi_dung u
        INNER JOIN tbl_vai_tro v ON u.ma_vai_tro = v.ma_vai_tro
        WHERE u.ten_dang_nhap = @ten_dang_nhap;
      `);

    const userRow = userRes.recordset[0];
    if (!userRow) {
      return res.status(401).json({
        ok: false,
        message: `Tài khoản "${cleanUser}" không tồn tại trong bảng tbl_nguoi_dung!`
      });
    }

    if (userRow.trang_thai !== 'ACTIVE') {
      return res.status(403).json({
        ok: false,
        message: `Tài khoản "${cleanUser}" hiện đang bị khóa (${userRow.trang_thai})!`
      });
    }

    if (cleanRole && userRow.ma_vai_tro !== cleanRole) {
      return res.status(403).json({
        ok: false,
        message: `Tài khoản "${cleanUser}" thuộc vai trò ${userRow.ten_vai_tro}, không thuộc vai trò bạn đang chọn!`
      });
    }

    if (userRow.mat_khau_hash !== cleanPass) {
      return res.status(401).json({
        ok: false,
        message: 'Mật khẩu không chính xác! Vui lòng kiểm tra lại mật khẩu trong CSDL.'
      });
    }

    const userPayload = {
      userId: userRow.ma_nguoi_dung,
      username: userRow.ten_dang_nhap,
      fullName: userRow.ho_va_ten,
      phone: userRow.so_dien_thoai,
      roleId: userRow.ma_vai_tro,
      roleName: userRow.ten_vai_tro,
      canEditPrice: Boolean(userRow.cho_phep_sua_gia),
      canApproveStock: Boolean(userRow.cho_phep_duyet_kho),
      canViewRevenue: Boolean(userRow.cho_phep_xem_doanh_thu),
      status: userRow.trang_thai
    };

    /* Ghi nhận lịch sử chuyển đổi tài khoản vào bảng tbl_nhat_ky_he_thong */
    await pool.request()
      .input('ma_nguoi_dung', sql.Int, userRow.ma_nguoi_dung)
      .input('khoa_ban_ghi', sql.VarChar(50), userRow.ten_dang_nhap)
      .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({
        username: userRow.ten_dang_nhap,
        fullName: userRow.ho_va_ten,
        roleId: userRow.ma_vai_tro,
        roleName: userRow.ten_vai_tro
      }))
      .query(`
        INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
        VALUES (@ma_nguoi_dung, 'AUTH_SWITCH_ROLE', 'tbl_nguoi_dung', @khoa_ban_ghi, @du_lieu_moi_json);
      `);

    res.json({
      ok: true,
      user: userPayload,
      message: `Đăng nhập thành công: ${userRow.ho_va_ten} (${userRow.ten_vai_tro})`
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
