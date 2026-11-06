/* ============================================================================
   API ĐỊNH TUYẾN MÀN HÌNH 2: NHẬP KHO & KIỂM NHẬP CẢM QUAN GPP (UC-02)
   File: backend/routes/nhap-kho-gpp.routes.js
   Chức năng: Quản lý nhà cung cấp đạt chuẩn GDP, thêm nhanh quy cách ĐVT,
   lưu biên bản kiểm nhập cảm quan GPP (Bước 1), phê duyệt cộng tồn kho cơ bản (Bước 2)
   và truy vấn đầy đủ Lịch sử phiếu nhập kho + Chi tiết phiếu nhập (tbl_ct_phieu_nhap)
   ============================================================================ */

const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');
const { requireUser } = require('../utils/permission');

/* Hàm nội bộ phân loại trạng thái lô tự động dựa theo số ngày hạn sử dụng còn lại */
function resolveLotStatusByExpDate(expDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(String(expDateStr).slice(0, 10) + 'T00:00:00');
  const daysLeft = Math.round((expDate - today) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0) return 'KHOA_HET_HAN';
  if (daysLeft <= 30) return 'CAN_HAN_30';
  if (daysLeft <= 60) return 'CAN_HAN_60';
  if (daysLeft <= 90) return 'CAN_HAN_90';
  if (daysLeft <= 180) return 'CAN_HAN_180';
  return 'KHA_DUNG';
}

/* Hàm API GET /data: Lấy danh sách Nhà cung cấp GDP, Danh mục thuốc + ĐVT và Lịch sử phiếu nhập kho + Chi tiết lô nhập */
router.get('/data', async (req, res) => {
  try {
    const pool = await getPool();

    /* Tự động đồng bộ trạng thái HET_HIEU_LUC nếu ngày hết hạn GDP đã qua */
    await pool.request().query(`
      UPDATE tbl_nha_cung_cap_gdp
      SET trang_thai_gdp = 'HET_HIEU_LUC'
      WHERE ngay_het_han IS NOT NULL
        AND ngay_het_han < CAST(GETDATE() AS DATE)
        AND trang_thai_gdp <> 'HET_HIEU_LUC';
    `);

    /* Truy vấn bảng tbl_nha_cung_cap_gdp lấy hồ sơ pháp lý nhà phân phối */
    const suppliersRes = await pool.request().query(`
      SELECT ma_ncc, ten_nha_phan_phoi, ma_so_thue, so_chung_nhan_gdp,
             CONVERT(VARCHAR(10), ngay_cap_gdp, 23) AS ngay_cap_gdp,
             CONVERT(VARCHAR(10), ngay_het_han, 23) AS ngay_het_han,
             trang_thai_gdp, so_dien_thoai, email, dia_chi
      FROM tbl_nha_cung_cap_gdp
      ORDER BY ma_ncc ASC;
    `);

    /* Truy vấn bảng tbl_dm_thuoc lấy danh sách thuốc đang hoạt động */
    const drugsRes = await pool.request().query(`
      SELECT ma_thuoc, ten_thuoc, hoat_chat, don_vi_co_ban
      FROM tbl_dm_thuoc
      WHERE ISNULL(trang_thai, 'ACTIVE') = 'ACTIVE'
      ORDER BY ma_thuoc ASC;
    `);

    /* Truy vấn bảng tbl_quy_doi_don_vi lấy tỷ lệ quy đổi các cấp đơn vị tính */
    const unitsRes = await pool.request().query(`
      SELECT ma_quy_doi, ma_thuoc, ten_don_vi, ty_le_quy_doi, gia_ban_niem_yet
      FROM tbl_quy_doi_don_vi
      ORDER BY ma_thuoc ASC, ty_le_quy_doi DESC;
    `);

    /* Truy vấn bảng tbl_phieu_nhap_kho kết hợp tbl_nha_cung_cap_gdp và tbl_nguoi_dung */
    const receiptsRes = await pool.request().query(`
      SELECT
        p.ma_phieu_nhap,
        p.so_phieu_nhap,
        p.ma_ncc,
        n.ten_nha_phan_phoi,
        n.so_chung_nhan_gdp,
        p.so_hoa_don_vat,
        CONVERT(VARCHAR(10), p.ngay_hoa_don, 23) AS ngay_hoa_don,
        p.file_chung_tu_url,
        CONVERT(VARCHAR(19), p.ngay_gio_lap, 120) AS ngay_gio_lap,
        p.ma_nhan_vien_lap,
        nv.ho_va_ten AS ten_nhan_vien_lap,
        p.ma_quan_ly_duyet,
        ql.ho_va_ten AS ten_quan_ly_duyet,
        p.kenh_phe_duyet,
        p.chk_bao_bi_nguyen_ven,
        p.chk_nhan_lo_hsd_khop,
        p.chk_nhiet_do_bao_quan,
        p.ly_do_dac_cach,
        p.tong_tien_nhap,
        p.trang_thai_nhap
      FROM tbl_phieu_nhap_kho p
      INNER JOIN tbl_nha_cung_cap_gdp n ON p.ma_ncc = n.ma_ncc
      LEFT JOIN tbl_nguoi_dung nv ON p.ma_nhan_vien_lap = nv.ma_nguoi_dung
      LEFT JOIN tbl_nguoi_dung ql ON p.ma_quan_ly_duyet = ql.ma_nguoi_dung
      ORDER BY p.ma_phieu_nhap DESC;
    `);

    /* Truy vấn bảng tbl_ct_phieu_nhap kết hợp tbl_lo_thuoc, tbl_dm_thuoc và tbl_quy_doi_don_vi */
    const detailsRes = await pool.request().query(`
      SELECT
        ct.ma_ct_nhap,
        ct.ma_phieu_nhap,
        ct.ma_lo,
        ISNULL(l.ma_lo_hien_thi, 'LO-' + RIGHT('00' + CAST(l.ma_lo AS VARCHAR(10)), 2)) AS ma_lo_hien_thi,
        l.ma_thuoc,
        d.ten_thuoc,
        d.hoat_chat,
        l.so_lo,
        CONVERT(VARCHAR(10), l.ngay_san_xuat, 23) AS ngay_san_xuat,
        CONVERT(VARCHAR(10), l.han_dung, 23) AS han_dung,
        l.don_vi_co_ban,
        l.gia_von_nhap,
        l.trang_thai_lo,
        ct.ma_quy_doi,
        q.ten_don_vi,
        q.ty_le_quy_doi,
        ct.so_luong_nhap,
        ct.so_luong_co_ban,
        ct.don_gia_nhap,
        ct.vat_phan_tram,
        ct.dat_cam_quan_gpp,
        ct.ghi_chu_han_gpp
      FROM tbl_ct_phieu_nhap ct
      INNER JOIN tbl_lo_thuoc l ON ct.ma_lo = l.ma_lo
      INNER JOIN tbl_dm_thuoc d ON l.ma_thuoc = d.ma_thuoc
      INNER JOIN tbl_quy_doi_don_vi q ON ct.ma_quy_doi = q.ma_quy_doi
      ORDER BY ct.ma_phieu_nhap DESC, ct.ma_ct_nhap ASC;
    `);

    const drugs = drugsRes.recordset.map(d => {
      const mappedUnits = unitsRes.recordset
        .filter(u => u.ma_thuoc === d.ma_thuoc)
        .map(u => ({
          id: u.ma_quy_doi,
          unitName: u.ten_don_vi,
          rate: u.ty_le_quy_doi,
          price: Number(u.gia_ban_niem_yet)
        }));
      return {
        id: d.ma_thuoc,
        name: d.ten_thuoc,
        ingredient: d.hoat_chat,
        baseUnit: d.don_vi_co_ban,
        units: mappedUnits.length > 0
          ? mappedUnits
          : [{ id: 0, unitName: d.don_vi_co_ban || 'Viên', rate: 1, price: 0 }]
      };
    });

    const suppliers = suppliersRes.recordset.map(s => ({
      id: s.ma_ncc,
      name: s.ten_nha_phan_phoi,
      taxCode: s.ma_so_thue,
      gdpCert: s.so_chung_nhan_gdp,
      issueDate: s.ngay_cap_gdp,
      expDate: s.ngay_het_han,
      status: s.trang_thai_gdp
    }));

    const receipts = receiptsRes.recordset.map(r => {
      const lineDetails = detailsRes.recordset
        .filter(ct => Number(ct.ma_phieu_nhap) === Number(r.ma_phieu_nhap))
        .map(ct => ({
          detailId: Number(ct.ma_ct_nhap),
          receiptId: Number(ct.ma_phieu_nhap),
          lotDbId: Number(ct.ma_lo),
          lotCode: ct.ma_lo_hien_thi,
          drugId: ct.ma_thuoc,
          drugName: ct.ten_thuoc,
          ingredient: ct.hoat_chat,
          batchNo: ct.so_lo,
          mfgDate: ct.ngay_san_xuat,
          expDate: ct.han_dung,
          baseUnit: ct.don_vi_co_ban,
          baseCost: Number(ct.gia_von_nhap),
          lotStatus: ct.trang_thai_lo,
          unitId: Number(ct.ma_quy_doi),
          unitName: ct.ten_don_vi,
          rate: Number(ct.ty_le_quy_doi),
          importQty: Number(ct.so_luong_nhap),
          baseQty: Number(ct.so_luong_co_ban),
          importPrice: Number(ct.don_gia_nhap),
          vatPercent: Number(ct.vat_phan_tram),
          lineTotal: Number(ct.so_luong_nhap) * Number(ct.don_gia_nhap),
          gppPassed: Boolean(ct.dat_cam_quan_gpp),
          gppNote: ct.ghi_chu_han_gpp || 'Đạt chuẩn (>= 180 ngày)'
        }));

      return {
        id: Number(r.ma_phieu_nhap),
        receiptCode: r.so_phieu_nhap,
        supplierId: r.ma_ncc,
        supplierName: r.ten_nha_phan_phoi,
        gdpCert: r.so_chung_nhan_gdp,
        invoiceNo: r.so_hoa_don_vat,
        invoiceDate: r.ngay_hoa_don,
        fileUrl: r.file_chung_tu_url,
        createdAt: r.ngay_gio_lap,
        createdById: r.ma_nhan_vien_lap,
        createdByName: r.ten_nhan_vien_lap || `NV #${r.ma_nhan_vien_lap}`,
        approvedById: r.ma_quan_ly_duyet,
        approvedByName: r.ten_quan_ly_duyet || (r.ma_quan_ly_duyet ? `QL #${r.ma_quan_ly_duyet}` : 'Chưa duyệt'),
        approvalChannel: r.kenh_phe_duyet || '—',
        chk1: Boolean(r.chk_bao_bi_nguyen_ven),
        chk2: Boolean(r.chk_nhan_lo_hsd_khop),
        chk3: Boolean(r.chk_nhiet_do_bao_quan),
        specialReason: r.ly_do_dac_cach,
        totalAmount: Number(r.tong_tien_nhap),
        status: r.trang_thai_nhap,
        details: lineDetails
      };
    });

    res.json({ ok: true, suppliers, drugs, receipts });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* Hàm API POST /them-nhanh-dvt: Thêm nhanh quy cách đóng gói mới vào bảng tbl_quy_doi_don_vi */
router.post('/them-nhanh-dvt', async (req, res) => {
  const { drugId, unitName, rate, price, userId } = req.body;
  if (!drugId || !unitName || Number(rate) < 1 || Number(price) <= 0) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập Tên quy cách, Tỷ lệ quy đổi >= 1 và Giá bán lẻ > 0!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Kiểm tra quyền cho_phep_sua_gia trong bảng tbl_vai_tro (bắt buộc đăng nhập, không bỏ qua khi thiếu userId) */
      const actor = await requireUser(transaction, userId, 'cho_phep_sua_gia', 'thêm quy cách ĐVT và định giá bán');

      const dupCheck = await new sql.Request(transaction)
        .input('ma_thuoc', sql.NVarChar(20), drugId)
        .input('ten_don_vi', sql.NVarChar(50), unitName.trim())
        .query(`
          SELECT TOP 1 ma_quy_doi
          FROM tbl_quy_doi_don_vi
          WHERE ma_thuoc = @ma_thuoc AND ten_don_vi = @ten_don_vi;
        `);
      if (dupCheck.recordset.length > 0) {
        throw new Error(`Quy cách "${unitName.trim()}" đã tồn tại cho mã thuốc ${drugId} trong CSDL!`);
      }

      const unitLevel = Number(rate) === 1 ? 1 : (Number(rate) < 50 ? 2 : 3);
      await new sql.Request(transaction)
        .input('ma_thuoc', sql.NVarChar(20), drugId)
        .input('ten_don_vi', sql.NVarChar(50), unitName.trim())
        .input('ty_le_quy_doi', sql.Int, Number(rate))
        .input('gia_ban_niem_yet', sql.Decimal(18, 2), Number(price))
        .input('cap_don_vi', sql.TinyInt, unitLevel)
        .query(`
          INSERT INTO tbl_quy_doi_don_vi (ma_thuoc, ten_don_vi, ty_le_quy_doi, gia_ban_niem_yet, cap_don_vi, la_don_vi_xuat_hd)
          VALUES (@ma_thuoc, @ten_don_vi, @ty_le_quy_doi, @gia_ban_niem_yet, @cap_don_vi, 0);
        `);

      /* Ghi nhật ký kiểm toán vào tbl_nhat_ky_he_thong */
      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, actor.ma_nguoi_dung)
        .input('khoa_ban_ghi', sql.VarChar(50), drugId)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({ drugId, unitName, rate: Number(rate), price: Number(price) }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'QUICK_ADD_UNIT', 'tbl_quy_doi_don_vi', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({ ok: true, message: `Đã lưu quy cách "${unitName}" vào bảng tbl_quy_doi_don_vi trên SQL Server!` });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

/* Hàm API POST /gui-kiem-nhap: Bước 1 (Dược sĩ) lưu phiếu nhập trạng thái CHO_KIEM_NHAP / CHO_DUYET_DAC_CACH (Chưa cộng tồn khả dụng) */
router.post('/gui-kiem-nhap', async (req, res) => {
  const { supplierId, invoiceNo, invoiceDate, fileUrl, specialReason, lines, checklist, userId } = req.body;
  if (!supplierId || !invoiceNo || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ ok: false, message: 'Phiếu nhập thiếu thông tin chứng từ hoặc danh sách lô thuốc!' });
  }

  const chk1 = Boolean(checklist?.chk1);
  const chk2 = Boolean(checklist?.chk2);
  const chk3 = Boolean(checklist?.chk3);
  if (!chk1 || !chk2 || !chk3) {
    return res.status(400).json({ ok: false, message: 'Bắt buộc tích xác nhận đủ 3 mục Checklist Kiểm nhập cảm quan chuẩn GPP!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const supCheck = await new sql.Request(transaction)
        .input('ma_ncc', sql.NVarChar(20), supplierId)
        .query(`SELECT trang_thai_gdp, ngay_het_han FROM tbl_nha_cung_cap_gdp WHERE ma_ncc = @ma_ncc`);

      const supRow = supCheck.recordset[0];
      if (!supRow || supRow.trang_thai_gdp === 'HET_HIEU_LUC' || (supRow.ngay_het_han && new Date(supRow.ngay_het_han) < new Date())) {
        throw new Error('ERR_GDP_EXPIRED: Nhà phân phối đã hết hạn chứng nhận GDP! Chặn nhập kho.');
      }

      const hasShortExpiry = lines.some(l => Boolean(l.isShortExpiry));
      if (hasShortExpiry && !String(specialReason || '').trim()) {
        throw new Error('Phiếu nhập có lô cận hạn (< 180 ngày), bắt buộc nhập Lý do trình duyệt đặc cách!');
      }

      const pendingStatus = hasShortExpiry ? 'CHO_DUYET_DAC_CACH' : 'CHO_KIEM_NHAP';
      const totalAmount = lines.reduce((sum, l) => sum + Number(l.lineTotal || 0), 0);
      const receiptCode = 'PNK-' + Date.now().toString().slice(-8);
      /* Dược sĩ hoặc Chủ nhà thuốc đều được lập phiếu, nhưng bắt buộc là tài khoản hợp lệ đang ACTIVE */
      const creator = await requireUser(transaction, userId, null, 'lập phiếu nhập kho');
      const creatorId = creator.ma_nguoi_dung;

      const pnkRes = await new sql.Request(transaction)
        .input('so_phieu_nhap', sql.VarChar(30), receiptCode)
        .input('ma_ncc', sql.NVarChar(20), supplierId)
        .input('so_hoa_don_vat', sql.VarChar(50), invoiceNo.trim())
        .input('ngay_hoa_don', sql.Date, invoiceDate || new Date().toISOString().slice(0, 10))
        .input('file_chung_tu_url', sql.NVarChar(255), fileUrl || 'hoadon_vat.pdf')
        .input('ma_nv_lap', sql.Int, creatorId)
        .input('chk1', sql.Bit, chk1 ? 1 : 0)
        .input('chk2', sql.Bit, chk2 ? 1 : 0)
        .input('chk3', sql.Bit, chk3 ? 1 : 0)
        .input('ly_do_dac_cach', sql.NVarChar(500), specialReason || null)
        .input('tong_tien_nhap', sql.Decimal(18, 2), totalAmount)
        .input('trang_thai_nhap', sql.VarChar(25), pendingStatus)
        .query(`
          INSERT INTO tbl_phieu_nhap_kho (
            so_phieu_nhap, ma_ncc, so_hoa_don_vat, ngay_hoa_don, file_chung_tu_url,
            ma_nhan_vien_lap, ma_quan_ly_duyet, kenh_phe_duyet,
            chk_bao_bi_nguyen_ven, chk_nhan_lo_hsd_khop, chk_nhiet_do_bao_quan,
            ly_do_dac_cach, tong_tien_nhap, trang_thai_nhap
          )
          VALUES (
            @so_phieu_nhap, @ma_ncc, @so_hoa_don_vat, @ngay_hoa_don, @file_chung_tu_url,
            @ma_nv_lap, NULL, NULL,
            @chk1, @chk2, @chk3,
            @ly_do_dac_cach, @tong_tien_nhap, @trang_thai_nhap
          );
          SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ma_phieu_nhap;
        `);

      const maPhieuNhap = pnkRes.recordset[0].ma_phieu_nhap;

      for (const line of lines) {
        const autoLotStatus = resolveLotStatusByExpDate(line.exp);
        if (autoLotStatus === 'KHOA_HET_HAN' || (line.mfg && new Date(line.exp) <= new Date(line.mfg))) {
          throw new Error(`Lô ${line.batchNo} có hạn sử dụng (${line.exp}) không hợp lệ hoặc đã hết hạn! Cấm nhập kho.`);
        }

        /* Kiểm tra xem lô (ma_thuoc, so_lo, han_dung) đã tồn tại trong tbl_lo_thuoc chưa */
        const existLotRes = await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), line.drugId)
          .input('so_lo', sql.NVarChar(50), line.batchNo.trim())
          .input('han_dung', sql.Date, line.exp)
          .query(`
            SELECT TOP 1 ma_lo FROM tbl_lo_thuoc
            WHERE ma_thuoc = @ma_thuoc AND so_lo = @so_lo AND han_dung = @han_dung;
          `);

        let maLo = existLotRes.recordset[0]?.ma_lo;

        if (!maLo) {
          /* Sinh mã hiển thị LO-xx an toàn bằng MAX */
          const maxLoRes = await new sql.Request(transaction).query(`
            SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(ma_lo_hien_thi, 4, 10) AS INT)), 0) + 1 AS next_num
            FROM tbl_lo_thuoc
            WHERE ma_lo_hien_thi LIKE 'LO-%';
          `);
          const nextLotCode = 'LO-' + String(maxLoRes.recordset[0].next_num || 1).padStart(2, '0');

          /* Tạo bản ghi lô ở trạng thái CHO_DUYET_NHAP với so_luong_ton = 0 (chưa cộng tồn khả dụng theo BR-INV-02) */
          const lotInsertRes = await new sql.Request(transaction)
            .input('ma_lo_hien_thi', sql.VarChar(20), nextLotCode)
            .input('ma_thuoc', sql.NVarChar(20), line.drugId)
            .input('so_lo', sql.NVarChar(50), line.batchNo.trim())
            .input('ngay_san_xuat', sql.Date, line.mfg)
            .input('han_dung', sql.Date, line.exp)
            .input('don_vi_co_ban', sql.NVarChar(30), line.baseUnit || 'Viên')
            .input('gia_von_nhap', sql.Decimal(18, 2), Math.round(Number(line.price) / Number(line.rate || 1)))
            .query(`
              INSERT INTO tbl_lo_thuoc (
                ma_lo_hien_thi, ma_thuoc, so_lo, ngay_san_xuat, han_dung,
                so_luong_ton, don_vi_co_ban, gia_von_nhap, trang_thai_lo
              )
              VALUES (
                @ma_lo_hien_thi, @ma_thuoc, @so_lo, @ngay_san_xuat, @han_dung,
                0, @don_vi_co_ban, @gia_von_nhap, 'CHO_DUYET_NHAP'
              );
              SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ma_lo;
            `);
          maLo = lotInsertRes.recordset[0].ma_lo;
        }

        const qdRes = await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), line.drugId)
          .input('ten_don_vi', sql.NVarChar(50), line.unitName)
          .query(`SELECT TOP 1 ma_quy_doi FROM tbl_quy_doi_don_vi WHERE ma_thuoc = @ma_thuoc AND ten_don_vi = @ten_don_vi`);
        const maQuyDoi = qdRes.recordset[0]?.ma_quy_doi || 1;

        const gppNoteText = line.isShortExpiry
          ? 'Cận hạn (< 180 ngày - Chờ duyệt đặc cách)'
          : 'Đạt chuẩn (>= 180 ngày)';

        await new sql.Request(transaction)
          .input('ma_phieu_nhap', sql.BigInt, maPhieuNhap)
          .input('ma_lo', sql.BigInt, maLo)
          .input('ma_quy_doi', sql.BigInt, maQuyDoi)
          .input('so_luong_nhap', sql.Int, Number(line.qty))
          .input('so_luong_co_ban', sql.Int, Number(line.baseQty))
          .input('don_gia_nhap', sql.Decimal(18, 2), Number(line.price))
          .input('ghi_chu_han_gpp', sql.NVarChar(255), gppNoteText)
          .query(`
            INSERT INTO tbl_ct_phieu_nhap (
              ma_phieu_nhap, ma_lo, ma_quy_doi, so_luong_nhap, so_luong_co_ban,
              don_gia_nhap, vat_phan_tram, dat_cam_quan_gpp, ghi_chu_han_gpp
            )
            VALUES (
              @ma_phieu_nhap, @ma_lo, @ma_quy_doi, @so_luong_nhap, @so_luong_co_ban,
              @don_gia_nhap, 5, 1, @ghi_chu_han_gpp
            );
          `);
      }

      /* Ghi nhật ký kiểm toán vào tbl_nhat_ky_he_thong */
      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, creatorId)
        .input('khoa_ban_ghi', sql.VarChar(50), receiptCode)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({ receiptCode, supplierId, invoiceNo, totalAmount, status: pendingStatus }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'SUBMIT_IMPORT_INSPECTION', 'tbl_phieu_nhap_kho', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({
        ok: true,
        receiptCode,
        status: pendingStatus,
        message: `Đã lưu Phiếu kiểm nhập cảm quan (${receiptCode} - ${pendingStatus}) vào SQL Server! Chờ Chủ nhà thuốc phê duyệt cộng tồn kho.`
      });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

/* Hàm API POST /phe-duyet-nhap: Thực thi Transaction phê duyệt phiếu nhập kho và cộng tồn cơ bản vào tbl_lo_thuoc */
router.post('/phe-duyet-nhap', async (req, res) => {
  const { supplierId, invoiceNo, invoiceDate, fileUrl, specialReason, lines, checklist, userId } = req.body;
  if (!supplierId || !invoiceNo || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ ok: false, message: 'Phiếu nhập thiếu thông tin chứng từ hoặc danh sách lô thuốc!' });
  }

  const chk1 = Boolean(checklist?.chk1);
  const chk2 = Boolean(checklist?.chk2);
  const chk3 = Boolean(checklist?.chk3);
  if (!chk1 || !chk2 || !chk3) {
    return res.status(400).json({ ok: false, message: 'Không thể phê duyệt khi Checklist Kiểm nhập cảm quan GPP chưa đạt 100%!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Kiểm tra quyền cho_phep_duyet_kho trong bảng tbl_vai_tro */
      const approver = await requireUser(transaction, userId, 'cho_phep_duyet_kho', 'Phê duyệt nhập kho');
      const approverId = approver.ma_nguoi_dung;

      /* Kiểm tra trạng thái chứng nhận GDP và hạn GDP của nhà phân phối trên SQL Server */
      const supCheck = await new sql.Request(transaction)
        .input('ma_ncc', sql.NVarChar(20), supplierId)
        .query(`SELECT trang_thai_gdp, ngay_het_han FROM tbl_nha_cung_cap_gdp WHERE ma_ncc = @ma_ncc`);

      const supRow = supCheck.recordset[0];
      if (!supRow || supRow.trang_thai_gdp === 'HET_HIEU_LUC' || (supRow.ngay_het_han && new Date(supRow.ngay_het_han) < new Date())) {
        throw new Error('ERR_GDP_EXPIRED: Nhà phân phối đã hết hạn chứng nhận GDP! Chặn nhập kho.');
      }

      const hasShortExpiry = lines.some(l => Boolean(l.isShortExpiry));
      if (hasShortExpiry && !String(specialReason || '').trim()) {
        throw new Error('Vui lòng nhập Lý do duyệt đặc cách cho lô cận hạn (< 180 ngày) trước khi phê duyệt!');
      }

      const totalAmount = lines.reduce((sum, l) => sum + Number(l.lineTotal || 0), 0);
      const receiptCode = 'PNK-' + Date.now().toString().slice(-8);

      /* Thêm phiếu nhập kho trạng thái DA_DUYET_NHAP vào bảng tbl_phieu_nhap_kho */
      const pnkRes = await new sql.Request(transaction)
        .input('so_phieu_nhap', sql.VarChar(30), receiptCode)
        .input('ma_ncc', sql.NVarChar(20), supplierId)
        .input('so_hoa_don_vat', sql.VarChar(50), invoiceNo.trim())
        .input('ngay_hoa_don', sql.Date, invoiceDate || new Date().toISOString().slice(0, 10))
        .input('file_chung_tu_url', sql.NVarChar(255), fileUrl || 'hoadon_vat.pdf')
        .input('ma_nv_lap', sql.Int, approverId)
        .input('ma_ql_duyet', sql.Int, approverId)
        .input('chk1', sql.Bit, chk1 ? 1 : 0)
        .input('chk2', sql.Bit, chk2 ? 1 : 0)
        .input('chk3', sql.Bit, chk3 ? 1 : 0)
        .input('ly_do_dac_cach', sql.NVarChar(500), specialReason || null)
        .input('tong_tien_nhap', sql.Decimal(18, 2), totalAmount)
        .query(`
          INSERT INTO tbl_phieu_nhap_kho (
            so_phieu_nhap, ma_ncc, so_hoa_don_vat, ngay_hoa_don, file_chung_tu_url,
            ma_nhan_vien_lap, ma_quan_ly_duyet, kenh_phe_duyet,
            chk_bao_bi_nguyen_ven, chk_nhan_lo_hsd_khop, chk_nhiet_do_bao_quan,
            ly_do_dac_cach, tong_tien_nhap, trang_thai_nhap
          )
          VALUES (
            @so_phieu_nhap, @ma_ncc, @so_hoa_don_vat, @ngay_hoa_don, @file_chung_tu_url,
            @ma_nv_lap, @ma_ql_duyet, 'WEB_POS',
            @chk1, @chk2, @chk3,
            @ly_do_dac_cach, @tong_tien_nhap, 'DA_DUYET_NHAP'
          );
          SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ma_phieu_nhap;
        `);

      const maPhieuNhap = pnkRes.recordset[0].ma_phieu_nhap;

      /* Duyệt từng dòng lô thuốc để tạo mới hoặc cộng dồn tồn kho vào tbl_lo_thuoc */
      for (const line of lines) {
        const autoLotStatus = resolveLotStatusByExpDate(line.exp);
        if (autoLotStatus === 'KHOA_HET_HAN' || (line.mfg && new Date(line.exp) <= new Date(line.mfg))) {
          throw new Error(`Lô ${line.batchNo} có hạn sử dụng (${line.exp}) không hợp lệ hoặc đã hết hạn, tuyệt đối cấm nhập kho!`);
        }

        const unitCost = Math.round(Number(line.price) / Number(line.rate || 1));

        /* Kiểm tra lô (ma_thuoc, so_lo, han_dung) đã tồn tại chưa để cộng dồn thay vì lỗi trùng khóa uq_lo_thuoc_so_lo */
        const existLotRes = await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), line.drugId)
          .input('so_lo', sql.NVarChar(50), line.batchNo.trim())
          .input('han_dung', sql.Date, line.exp)
          .query(`
            SELECT TOP 1 ma_lo FROM tbl_lo_thuoc WITH (UPDLOCK, ROWLOCK)
            WHERE ma_thuoc = @ma_thuoc AND so_lo = @so_lo AND han_dung = @han_dung;
          `);

        let maLo = existLotRes.recordset[0]?.ma_lo;

        if (maLo) {
          await new sql.Request(transaction)
            .input('ma_lo', sql.BigInt, maLo)
            .input('add_qty', sql.Int, Number(line.baseQty))
            .input('gia_von_nhap', sql.Decimal(18, 2), unitCost)
            .input('trang_thai_lo', sql.VarChar(20), autoLotStatus)
            .query(`
              UPDATE tbl_lo_thuoc
              SET so_luong_ton = so_luong_ton + @add_qty,
                  gia_von_nhap = @gia_von_nhap,
                  trang_thai_lo = @trang_thai_lo
              WHERE ma_lo = @ma_lo;
            `);
        } else {
          const maxLoRes = await new sql.Request(transaction).query(`
            SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(ma_lo_hien_thi, 4, 10) AS INT)), 0) + 1 AS next_num
            FROM tbl_lo_thuoc
            WHERE ma_lo_hien_thi LIKE 'LO-%';
          `);
          const nextLotCode = 'LO-' + String(maxLoRes.recordset[0].next_num || 1).padStart(2, '0');

          const lotRes = await new sql.Request(transaction)
            .input('ma_lo_hien_thi', sql.VarChar(20), nextLotCode)
            .input('ma_thuoc', sql.NVarChar(20), line.drugId)
            .input('so_lo', sql.NVarChar(50), line.batchNo.trim())
            .input('ngay_san_xuat', sql.Date, line.mfg)
            .input('han_dung', sql.Date, line.exp)
            .input('so_luong_ton', sql.Int, Number(line.baseQty))
            .input('don_vi_co_ban', sql.NVarChar(30), line.baseUnit || 'Viên')
            .input('gia_von_nhap', sql.Decimal(18, 2), unitCost)
            .input('trang_thai_lo', sql.VarChar(20), autoLotStatus)
            .query(`
              INSERT INTO tbl_lo_thuoc (
                ma_lo_hien_thi, ma_thuoc, so_lo, ngay_san_xuat, han_dung,
                so_luong_ton, don_vi_co_ban, gia_von_nhap, trang_thai_lo
              )
              VALUES (
                @ma_lo_hien_thi, @ma_thuoc, @so_lo, @ngay_san_xuat, @han_dung,
                @so_luong_ton, @don_vi_co_ban, @gia_von_nhap, @trang_thai_lo
              );
              SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ma_lo;
            `);
          maLo = lotRes.recordset[0].ma_lo;
        }

        const qdRes = await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), line.drugId)
          .input('ten_don_vi', sql.NVarChar(50), line.unitName)
          .query(`SELECT TOP 1 ma_quy_doi FROM tbl_quy_doi_don_vi WHERE ma_thuoc = @ma_thuoc AND ten_don_vi = @ten_don_vi`);

        const maQuyDoi = qdRes.recordset[0]?.ma_quy_doi || 1;
        const gppNoteText = line.isShortExpiry
          ? 'Cận hạn (< 180 ngày - Đã duyệt đặc cách)'
          : 'Đạt chuẩn (>= 180 ngày)';

        /* Lưu chi tiết phiếu nhập vào bảng tbl_ct_phieu_nhap */
        await new sql.Request(transaction)
          .input('ma_phieu_nhap', sql.BigInt, maPhieuNhap)
          .input('ma_lo', sql.BigInt, maLo)
          .input('ma_quy_doi', sql.BigInt, maQuyDoi)
          .input('so_luong_nhap', sql.Int, Number(line.qty))
          .input('so_luong_co_ban', sql.Int, Number(line.baseQty))
          .input('don_gia_nhap', sql.Decimal(18, 2), Number(line.price))
          .input('ghi_chu_han_gpp', sql.NVarChar(255), gppNoteText)
          .query(`
            INSERT INTO tbl_ct_phieu_nhap (
              ma_phieu_nhap, ma_lo, ma_quy_doi, so_luong_nhap, so_luong_co_ban,
              don_gia_nhap, vat_phan_tram, dat_cam_quan_gpp, ghi_chu_han_gpp
            )
            VALUES (
              @ma_phieu_nhap, @ma_lo, @ma_quy_doi, @so_luong_nhap, @so_luong_co_ban,
              @don_gia_nhap, 5, 1, @ghi_chu_han_gpp
            );
          `);
      }

      /* Ghi nhật ký kiểm toán phê duyệt nhập kho */
      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, approverId)
        .input('khoa_ban_ghi', sql.VarChar(50), receiptCode)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({ receiptCode, supplierId, invoiceNo, totalAmount }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'APPROVE_IMPORT_STOCK', 'tbl_phieu_nhap_kho', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({
        ok: true,
        receiptCode,
        message: `PHÊ DUYỆT THÀNH CÔNG (${receiptCode}): Đã quy đổi và cộng số lượng tồn cơ bản vào bảng tbl_lo_thuoc trên SQL Server!`
      });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

/* Hàm API POST /duyet-phieu-cho: Phê duyệt một phiếu nhập đang ở trạng thái CHO_KIEM_NHAP / CHO_DUYET_DAC_CACH trong lịch sử */
router.post('/duyet-phieu-cho', async (req, res) => {
  const { receiptId, userId } = req.body;
  if (!receiptId) {
    return res.status(400).json({ ok: false, message: 'Thiếu mã phiếu nhập kho cần phê duyệt!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const approver = await requireUser(transaction, userId, 'cho_phep_duyet_kho', 'Phê duyệt phiếu nhập kho');
      const approverId = approver.ma_nguoi_dung;

      const pnkRes = await new sql.Request(transaction)
        .input('ma_phieu_nhap', sql.BigInt, Number(receiptId))
        .query(`
          SELECT ma_phieu_nhap, so_phieu_nhap, trang_thai_nhap
          FROM tbl_phieu_nhap_kho WITH (UPDLOCK, ROWLOCK)
          WHERE ma_phieu_nhap = @ma_phieu_nhap;
        `);
      const pnkRow = pnkRes.recordset[0];
      if (!pnkRow) {
        throw new Error('Không tìm thấy phiếu nhập kho trong CSDL!');
      }
      if (pnkRow.trang_thai_nhap === 'DA_DUYET_NHAP') {
        throw new Error(`Phiếu nhập ${pnkRow.so_phieu_nhap} đã được phê duyệt trước đó!`);
      }

      /* Lấy các dòng chi tiết của phiếu nhập để cộng tồn kho cho các lô CHO_DUYET_NHAP */
      const ctRes = await new sql.Request(transaction)
        .input('ma_phieu_nhap', sql.BigInt, Number(receiptId))
        .query(`
          SELECT ct.ma_lo, ct.so_luong_co_ban, l.han_dung, l.trang_thai_lo
          FROM tbl_ct_phieu_nhap ct
          INNER JOIN tbl_lo_thuoc l ON ct.ma_lo = l.ma_lo
          WHERE ct.ma_phieu_nhap = @ma_phieu_nhap;
        `);

      for (const ct of ctRes.recordset) {
        const autoStatus = resolveLotStatusByExpDate(ct.han_dung);
        /* Mọi phiếu tạo qua Bước 1 (/gui-kiem-nhap) đều chưa cộng tồn kho; riêng phiếu mẫu PNK-202610-002 trong seed data đã có sẵn tồn LO-06 = 70 thì giữ nguyên tránh cộng lặp */
        const isPreSeededReceipt = (pnkRow.so_phieu_nhap === 'PNK-202610-002' && ct.trang_thai_lo !== 'CHO_DUYET_NHAP');
        const addQty = isPreSeededReceipt ? 0 : Number(ct.so_luong_co_ban);
        await new sql.Request(transaction)
          .input('ma_lo', sql.BigInt, ct.ma_lo)
          .input('add_qty', sql.Int, addQty)
          .input('trang_thai_lo', sql.VarChar(20), autoStatus)
          .query(`
            UPDATE tbl_lo_thuoc
            SET so_luong_ton = so_luong_ton + @add_qty,
                trang_thai_lo = @trang_thai_lo
            WHERE ma_lo = @ma_lo;
          `);
      }

      await new sql.Request(transaction)
        .input('ma_phieu_nhap', sql.BigInt, Number(receiptId))
        .input('ma_ql_duyet', sql.Int, approverId)
        .query(`
          UPDATE tbl_phieu_nhap_kho
          SET trang_thai_nhap = 'DA_DUYET_NHAP',
              ma_quan_ly_duyet = @ma_ql_duyet,
              kenh_phe_duyet = 'WEB_POS'
          WHERE ma_phieu_nhap = @ma_phieu_nhap;
        `);

      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, approverId)
        .input('khoa_ban_ghi', sql.VarChar(50), pnkRow.so_phieu_nhap)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({
          receiptId: Number(receiptId),
          receiptCode: pnkRow.so_phieu_nhap,
          oldStatus: pnkRow.trang_thai_nhap,
          newStatus: 'DA_DUYET_NHAP'
        }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'APPROVE_PENDING_RECEIPT', 'tbl_phieu_nhap_kho', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({
        ok: true,
        message: `Đã phê duyệt phiếu nhập ${pnkRow.so_phieu_nhap} sang trạng thái DA_DUYET_NHAP và cập nhật tồn kho thành công!`
      });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

module.exports = router;
