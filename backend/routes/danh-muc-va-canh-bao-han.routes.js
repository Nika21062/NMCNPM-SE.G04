/* ============================================================================
   API ĐỊNH TUYẾN MÀN HÌNH 3: DANH MỤC THUỐC GPP & CẢNH BÁO LÔ/HẠN (UC-01 & UC-03)
   File: backend/routes/danh-muc-va-canh-bao-han.routes.js
   Chức năng: Quản lý hồ sơ thuốc chuẩn GPP, cấu hình ma trận quy đổi 3 cấp ĐVT,
   giám sát cảnh báo hạn dùng 30/60/90/180 ngày và lập phiếu xuất hủy/trả NCC
   ============================================================================ */

const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');
const { requireUser } = require('../utils/permission');

/* Hàm API GET /data: Truy vấn toàn bộ danh mục thuốc, ma trận ĐVT và danh sách lô thuốc từ View vw_lo_thuoc_fefo */
router.get('/data', async (req, res) => {
  try {
    const pool = await getPool();

    /* Tự động đồng bộ trạng thái lô (KHOA_HET_HAN, CAN_HAN_30/60/90/180, KHA_DUNG) theo số ngày còn lại trên SQL Server (BR-INV-05) */
    await pool.request().query(`
      UPDATE tbl_lo_thuoc
      SET trang_thai_lo = CASE
        WHEN so_ngay_con_lai <= 0 THEN 'KHOA_HET_HAN'
        WHEN so_ngay_con_lai <= 30 THEN 'CAN_HAN_30'
        WHEN so_ngay_con_lai <= 60 THEN 'CAN_HAN_60'
        WHEN so_ngay_con_lai <= 90 THEN 'CAN_HAN_90'
        WHEN so_ngay_con_lai <= 180 THEN 'CAN_HAN_180'
        ELSE 'KHA_DUNG'
      END
      WHERE trang_thai_lo NOT IN ('CHO_DUYET_NHAP', 'XUAT_HUY', 'XUAT_TRA_NCC');
    `);

    /* Lấy danh mục thuốc chuẩn GPP từ bảng tbl_dm_thuoc */
    const drugsRes = await pool.request().query(`
      SELECT ma_thuoc, ten_thuoc, hoat_chat, ham_luong, dang_bao_che,
             so_dang_ky, ma_vach_barcode, phan_loai_ke_don, don_vi_co_ban,
             ma_ncc, muc_ton_toi_thieu, vi_tri_tu_quay, ghi_chu_sop, trang_thai
      FROM tbl_dm_thuoc
      WHERE ISNULL(trang_thai, 'ACTIVE') = 'ACTIVE'
      ORDER BY ma_thuoc ASC;
    `);

    /* Lấy cấu hình đơn vị tính và giá bán niêm yết từ bảng tbl_quy_doi_don_vi */
    const unitsRes = await pool.request().query(`
      SELECT ma_quy_doi, ma_thuoc, ten_don_vi, ty_le_quy_doi, gia_ban_niem_yet, cap_don_vi, la_don_vi_xuat_hd
      FROM tbl_quy_doi_don_vi
      ORDER BY ma_thuoc ASC, ty_le_quy_doi ASC;
    `);

    /* Lấy danh sách lô thuốc kèm số ngày còn lại và mã màu cảnh báo từ View vw_lo_thuoc_fefo */
    const lotsRes = await pool.request().query(`
      SELECT ma_lo, ma_lo_hien_thi, ma_thuoc, so_lo,
             CONVERT(VARCHAR(10), ngay_san_xuat, 23) AS ngay_san_xuat,
             CONVERT(VARCHAR(10), han_dung, 23) AS han_dung,
             CONVERT(VARCHAR(10), ngay_nhap_kho, 23) AS ngay_nhap_kho,
             so_luong_ton, don_vi_co_ban, gia_von_nhap,
             trang_thai_lo, so_ngay_con_lai, ma_mau_canh_bao, cho_phep_xuat_fefo
      FROM vw_lo_thuoc_fefo
      ORDER BY han_dung ASC, ma_lo ASC;
    `);

    const drugs = drugsRes.recordset.map(d => {
      const mappedUnits = unitsRes.recordset
        .filter(u => u.ma_thuoc === d.ma_thuoc)
        .map(u => ({
          id: u.ma_quy_doi,
          unitName: u.ten_don_vi,
          rate: u.ty_le_quy_doi,
          price: Number(u.gia_ban_niem_yet),
          level: u.cap_don_vi,
          isDefaultSale: Boolean(u.la_don_vi_xuat_hd)
        }));
      return {
        id: d.ma_thuoc,
        barcode: d.ma_vach_barcode,
        name: d.ten_thuoc,
        ingredient: d.hoat_chat,
        strength: d.ham_luong,
        dosageForm: d.dang_bao_che,
        sdk: d.so_dang_ky,
        type: d.phan_loai_ke_don,
        baseUnit: d.don_vi_co_ban,
        supplierId: d.ma_ncc,
        minStock: Number(d.muc_ton_toi_thieu || 0),
        shelfLocation: d.vi_tri_tu_quay || 'Tủ A - Quầy bán lẻ',
        sop: d.ghi_chu_sop
          ? d.ghi_chu_sop.split('|')
          : ['Tư vấn đúng liều lượng và kiểm tra hạn dùng lô FEFO trước khi xuất bán.'],
        units: mappedUnits.length > 0
          ? mappedUnits
          : [{ id: 0, unitName: d.don_vi_co_ban || 'Viên', rate: 1, price: 0, level: 1, isDefaultSale: true }]
      };
    });

    const lots = lotsRes.recordset.map(l => ({
      dbId: Number(l.ma_lo),
      lotId: l.ma_lo_hien_thi,
      drugId: l.ma_thuoc,
      batchNo: l.so_lo,
      mfg: l.ngay_san_xuat,
      exp: l.han_dung,
      importDate: l.ngay_nhap_kho,
      baseQty: Number(l.so_luong_ton),
      baseCost: Number(l.gia_von_nhap),
      status: l.trang_thai_lo,
      daysLeft: Number(l.so_ngay_con_lai),
      alertColor: l.ma_mau_canh_bao,
      fefoEligible: Boolean(l.cho_phep_xuat_fefo)
    }));

    res.json({ ok: true, drugs, lots });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* Hàm API POST /thuoc: Thêm mới hồ sơ thuốc chuẩn GPP và cấu hình 3 cấp ĐVT vào SQL Server */
router.post('/thuoc', async (req, res) => {
  const { barcode, name, ingredient, strength, dosageForm, sdk, type, minStock, shelfLocation, sop, units, userId } = req.body;
  if (!barcode || !name || !ingredient || !sdk || !Array.isArray(units) || units.length === 0) {
    return res.status(400).json({ ok: false, message: 'ERR_MISSING_GPP_FIELDS: Vui lòng nhập đủ thông tin định danh thuốc và đơn vị tính!' });
  }
  const cleanType = String(type || 'OTC').trim().toUpperCase();
  if (!['OTC', 'ETC'].includes(cleanType)) {
    return res.status(400).json({ ok: false, message: 'ERR_INVALID_DRUG_TYPE: Phân loại thuốc chỉ chấp nhận OTC hoặc ETC!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Kiểm tra quyền cho_phep_sua_gia trong bảng tbl_vai_tro */
      const actor = await requireUser(transaction, userId, 'cho_phep_sua_gia', 'thêm thuốc mới và khóa giá bán niêm yết');
      const actorId = actor.ma_nguoi_dung;

      /* Kiểm tra trùng Mã vạch Barcode hoặc Số đăng ký (SĐK) trực tiếp trong bảng tbl_dm_thuoc */
      const dupDrugRes = await new sql.Request(transaction)
        .input('barcode_chk', sql.VarChar(50), barcode.trim())
        .input('sdk_chk', sql.VarChar(50), sdk.trim())
        .query(`
          SELECT TOP 1 ma_thuoc, ten_thuoc
          FROM tbl_dm_thuoc
          WHERE ma_vach_barcode = @barcode_chk OR so_dang_ky = @sdk_chk;
        `);
      if (dupDrugRes.recordset.length > 0) {
        throw new Error(`ERR_DUPLICATE_DRUG: Mã vạch Barcode hoặc Số đăng ký (SĐK) đã tồn tại trong CSDL (${dupDrugRes.recordset[0].ma_thuoc})!`);
      }

      /* Kiểm tra tính hợp lệ, đơn vị cơ bản cấp 1 (rate = 1), hệ số quy đổi tăng dần và không trùng tên ĐVT */
      if (Number(units[0]?.rate) !== 1) {
        throw new Error('ERR_INVALID_BASE_UNIT: Đơn vị cơ bản (Cấp 1) bắt buộc phải có hệ số quy đổi bằng 1!');
      }
      const seenUnitNames = new Set();
      let prevRate = 0;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        const cleanUName = String(u.unitName || '').trim().toLowerCase();
        const rateNum = Number(u.rate);
        const priceNum = Number(u.price);
        if (!cleanUName || !Number.isInteger(rateNum) || rateNum < 1 || !(priceNum > 0)) {
          throw new Error('ERR_INVALID_UNIT_RATE: Tên đơn vị tính không được để trống, tỷ lệ quy đổi phải là số nguyên >= 1 và giá bán niêm yết > 0!');
        }
        if (i > 0 && rateNum <= prevRate) {
          throw new Error(`ERR_INVALID_UNIT_HIERARCHY: Hệ số quy đổi của cấp đơn vị "${u.unitName}" (${rateNum}) phải lớn hơn cấp đơn vị liền trước (${prevRate})!`);
        }
        if (seenUnitNames.has(cleanUName)) {
          throw new Error(`ERR_DUPLICATE_UNIT_NAME: Tên đơn vị tính "${u.unitName}" bị lặp lại nhiều lần trong cùng một thuốc!`);
        }
        seenUnitNames.add(cleanUName);
        prevRate = rateNum;
      }

      /* Sinh mã thuốc tự động tiếp theo dựa trên MAX(DRGxx) để không bị trùng khóa khi xóa bản ghi ở giữa */
      const maxRes = await new sql.Request(transaction).query(`
        SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(ma_thuoc, 4, 10) AS INT)), 0) + 1 AS next_num
        FROM tbl_dm_thuoc
        WHERE ma_thuoc LIKE 'DRG%';
      `);
      const nextNum = maxRes.recordset[0].next_num || 1;
      const newDrugId = 'DRG' + String(nextNum).padStart(2, '0');
      const baseUnitName = (units[0].unitName || 'Viên').trim();
      const cleanStrength = String(strength || '').trim() || null;
      const cleanDosageForm = String(dosageForm || '').trim() || 'Viên nén';
      const cleanShelf = String(shelfLocation || '').trim() || 'Tủ A - Quầy bán lẻ';
      const cleanSop = String(sop || '').trim() || (
        cleanType === 'ETC'
          ? 'Bước 1: Kiểm tra đơn thuốc bác sĩ hợp lệ (ETC)|Bước 2: Tư vấn đúng liều lượng và cảnh báo tác dụng phụ|Bước 3: Kiểm tra hạn dùng lô FEFO trước khi giao thuốc'
          : 'Bước 1: Hỏi triệu chứng và tiền sử dị ứng thuốc (OTC)|Bước 2: Hướng dẫn liều dùng và thời điểm uống|Bước 3: Kiểm tra hạn dùng lô FEFO trước khi xuất bán'
      );

      /* Lưu thông tin định danh thuốc vào bảng tbl_dm_thuoc */
      await new sql.Request(transaction)
        .input('ma_thuoc', sql.NVarChar(20), newDrugId)
        .input('ten_thuoc', sql.NVarChar(300), name.trim())
        .input('hoat_chat', sql.NVarChar(200), ingredient.trim())
        .input('ham_luong', sql.NVarChar(100), cleanStrength)
        .input('dang_bao_che', sql.NVarChar(100), cleanDosageForm)
        .input('so_dang_ky', sql.VarChar(50), sdk.trim())
        .input('ma_vach_barcode', sql.VarChar(50), barcode.trim())
        .input('phan_loai_ke_don', sql.VarChar(10), cleanType)
        .input('don_vi_co_ban', sql.NVarChar(30), baseUnitName)
        .input('muc_ton_toi_thieu', sql.Int, Math.max(0, Number(minStock ?? 50)))
        .input('vi_tri_tu_quay', sql.NVarChar(50), cleanShelf)
        .input('ghi_chu_sop', sql.NVarChar(sql.MAX), cleanSop)
        .query(`
          INSERT INTO tbl_dm_thuoc (
            ma_thuoc, ten_thuoc, hoat_chat, ham_luong, dang_bao_che,
            so_dang_ky, ma_vach_barcode, phan_loai_ke_don, don_vi_co_ban,
            muc_ton_toi_thieu, vi_tri_tu_quay, ghi_chu_sop
          )
          VALUES (
            @ma_thuoc, @ten_thuoc, @hoat_chat, @ham_luong, @dang_bao_che,
            @so_dang_ky, @ma_vach_barcode, @phan_loai_ke_don, @don_vi_co_ban,
            @muc_ton_toi_thieu, @vi_tri_tu_quay, @ghi_chu_sop
          )
        `);

      /* Lưu ma trận quy đổi 3 cấp đơn vị tính vào bảng tbl_quy_doi_don_vi */
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), newDrugId)
          .input('ten_don_vi', sql.NVarChar(50), u.unitName.trim())
          .input('ty_le_quy_doi', sql.Int, Number(u.rate))
          .input('gia_ban_niem_yet', sql.Decimal(18, 2), Number(u.price))
          .input('cap_don_vi', sql.TinyInt, i + 1)
          .input('la_don_vi_xuat_hd', sql.Bit, i === 1 ? 1 : 0)
          .query(`
            INSERT INTO tbl_quy_doi_don_vi (ma_thuoc, ten_don_vi, ty_le_quy_doi, gia_ban_niem_yet, cap_don_vi, la_don_vi_xuat_hd)
            VALUES (@ma_thuoc, @ten_don_vi, @ty_le_quy_doi, @gia_ban_niem_yet, @cap_don_vi, @la_don_vi_xuat_hd)
          `);
      }

      /* Ghi nhật ký kiểm toán khởi tạo thuốc và khóa giá bán */
      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, actorId)
        .input('khoa_ban_ghi', sql.VarChar(50), newDrugId)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({ newDrugId, name, barcode, sdk, units }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'CREATE_DRUG_PRICE_MATRIX', 'tbl_dm_thuoc', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({
        ok: true,
        drugId: newDrugId,
        message: `MSG_DRUG_SAVED_SUCCESS: Đã lưu hồ sơ thuốc GPP (${newDrugId}), cấu hình 3 cấp ĐVT và khóa giá POS vào SQL Server!`
      });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

/* Ngưỡng nguy cấp: chỉ lô quá hạn hoặc còn <= 30 ngày mới được đưa vào phiếu xuất hủy / trả NCC */
const DESTROY_MAX_DAYS_LEFT = 30;
const ALLOWED_EXPORT_TYPES = ['XUAT_HUY_HET_HAN', 'XUAT_TRA_NCC'];
/* Trạng thái lô không được phép xuất hủy: chưa duyệt nhập kho hoặc đã xuất khỏi kho */
const NON_DESTROYABLE_STATUSES = ['CHO_DUYET_NHAP', 'XUAT_HUY', 'XUAT_TRA_NCC'];

/* Hàm API POST /xuat-huy: Lập phiếu xuất hủy / trả NCC cho các lô thuốc quá hạn hoặc nguy cấp (<= 30 ngày) */
router.post('/xuat-huy', async (req, res) => {
  const { exportType, reason, lotIds, userId } = req.body;

  const cleanExportType = exportType || 'XUAT_HUY_HET_HAN';
  if (!ALLOWED_EXPORT_TYPES.includes(cleanExportType)) {
    return res.status(400).json({ ok: false, message: `Loại phiếu xuất "${exportType}" không hợp lệ (chỉ chấp nhận XUAT_HUY_HET_HAN hoặc XUAT_TRA_NCC)!` });
  }
  const cleanLotIds = Array.isArray(lotIds)
    ? [...new Set(lotIds.map(x => String(x || '').trim()).filter(Boolean))]
    : [];
  if (cleanLotIds.length === 0) {
    return res.status(400).json({ ok: false, message: 'Vui lòng chọn ít nhất một lô thuốc cần xuất hủy / trả NCC!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Xuất hủy / trả NCC làm giảm tồn kho nên chỉ tài khoản có quyền cho_phep_duyet_kho (Chủ nhà thuốc) được ký duyệt */
      const actor = await requireUser(transaction, userId, 'cho_phep_duyet_kho', 'ký duyệt phiếu xuất hủy / trả NCC');
      const actorId = actor.ma_nguoi_dung;
      const noteCode = 'PXH-' + Date.now().toString().slice(-8);
      const targetLotStatus = cleanExportType === 'XUAT_TRA_NCC' ? 'XUAT_TRA_NCC' : 'XUAT_HUY';

      /* BƯỚC 1: Khóa dòng và kiểm tra TOÀN BỘ lô trước khi ghi; chỉ cần 1 lô không hợp lệ là hủy cả phiếu */
      const validLots = [];
      const errors = [];
      for (const lotCode of cleanLotIds) {
        const lotRes = await new sql.Request(transaction)
          .input('ma_lo_hien_thi', sql.VarChar(20), lotCode)
          .query(`
            SELECT TOP 1 ma_lo, so_lo, so_luong_ton, trang_thai_lo, so_ngay_con_lai,
                   ISNULL(ma_lo_hien_thi, 'LO-' + RIGHT('00' + CAST(ma_lo AS VARCHAR(10)), 2)) AS ma_lo_hien_thi
            FROM tbl_lo_thuoc WITH (UPDLOCK, ROWLOCK)
            WHERE ISNULL(ma_lo_hien_thi, 'LO-' + RIGHT('00' + CAST(ma_lo AS VARCHAR(10)), 2)) = @ma_lo_hien_thi
               OR CAST(ma_lo AS VARCHAR(20)) = @ma_lo_hien_thi;
          `);

        const row = lotRes.recordset[0];
        if (!row) {
          errors.push(`${lotCode}: không tồn tại`);
        } else if (NON_DESTROYABLE_STATUSES.includes(row.trang_thai_lo)) {
          errors.push(`${row.ma_lo_hien_thi} (${row.so_lo}): đang ở trạng thái ${row.trang_thai_lo}`);
        } else if (Number(row.so_luong_ton) <= 0) {
          errors.push(`${row.ma_lo_hien_thi} (${row.so_lo}): đã hết tồn kho`);
        } else if (Number(row.so_ngay_con_lai) > DESTROY_MAX_DAYS_LEFT) {
          errors.push(`${row.ma_lo_hien_thi} (${row.so_lo}): còn ${row.so_ngay_con_lai} ngày (> ${DESTROY_MAX_DAYS_LEFT} ngày)`);
        } else {
          validLots.push(row);
        }
      }

      if (errors.length > 0) {
        const httpErr = new Error(`Không thể lập phiếu xuất hủy / trả NCC. Chỉ được xuất các lô đã quá hạn hoặc còn <= ${DESTROY_MAX_DAYS_LEFT} ngày và còn tồn kho. Lô không hợp lệ: ${errors.join('; ')}`);
        httpErr.status = 400;
        throw httpErr;
      }

      /* BƯỚC 2: Lập phiếu xuất kho (Chủ nhà thuốc lập kiêm ký duyệt) */
      const pxRes = await new sql.Request(transaction)
        .input('so_phieu_xuat', sql.VarChar(30), noteCode)
        .input('loai_xuat', sql.VarChar(30), cleanExportType)
        .input('ma_nv_lap', sql.Int, actorId)
        .input('ly_do_xuat', sql.NVarChar(500), reason || 'Thu hồi đưa vào tủ biệt trữ chờ tiêu hủy/trả NCC đối với lô quá hạn hoặc nguy cấp.')
        .query(`
          INSERT INTO tbl_phieu_xuat_kho (so_phieu_xuat, loai_xuat, ma_nhan_vien_lap, ma_quan_ly_duyet, ly_do_xuat, trang_thai)
          VALUES (@so_phieu_xuat, @loai_xuat, @ma_nv_lap, @ma_nv_lap, @ly_do_xuat, 'DA_DUYET');
          SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ma_phieu_xuat;
        `);

      const maPhieuXuat = pxRes.recordset[0].ma_phieu_xuat;
      const exportedSummary = [];

      /* BƯỚC 3: Ghi chi tiết phiếu xuất và đưa tồn kho của lô về 0 */
      for (const row of validLots) {
        await new sql.Request(transaction)
          .input('ma_phieu_xuat', sql.BigInt, maPhieuXuat)
          .input('ma_lo', sql.BigInt, row.ma_lo)
          .input('so_luong_xuat_co_ban', sql.Int, Number(row.so_luong_ton))
          .query(`
            INSERT INTO tbl_ct_phieu_xuat (ma_phieu_xuat, ma_lo, so_luong_xuat_co_ban, ghi_chu_kiem_soat)
            VALUES (@ma_phieu_xuat, @ma_lo, @so_luong_xuat_co_ban, N'Đã xuất hủy/trả NCC theo quy trình kiểm soát GPP');
          `);

        await new sql.Request(transaction)
          .input('ma_lo', sql.BigInt, row.ma_lo)
          .input('trang_thai_moi', sql.VarChar(20), targetLotStatus)
          .query(`
            UPDATE tbl_lo_thuoc
            SET so_luong_ton = 0, trang_thai_lo = @trang_thai_moi
            WHERE ma_lo = @ma_lo;

            /* Đóng các phiếu xuất cũ đang CHO_DUYET của cùng lô (vd: phiếu mẫu PXH-202610-001) vì lô đã được xử lý */
            UPDATE tbl_phieu_xuat_kho
            SET trang_thai = 'DA_DUYET'
            WHERE trang_thai = 'CHO_DUYET'
              AND ma_phieu_xuat IN (SELECT ma_phieu_xuat FROM tbl_ct_phieu_xuat WHERE ma_lo = @ma_lo);
          `);

        exportedSummary.push({
          ma_lo: row.ma_lo,
          so_lo: row.so_lo,
          exportedBaseQty: Number(row.so_luong_ton),
          daysLeft: Number(row.so_ngay_con_lai),
          oldStatus: row.trang_thai_lo,
          newStatus: targetLotStatus
        });
      }

      if (exportedSummary.length === 0) {
        throw new Error('Không tìm thấy lô thuốc nào còn tồn kho (> 0) để thực hiện xuất hủy / trả NCC!');
      }

      /* Ghi nhật ký kiểm toán vào bảng tbl_nhat_ky_he_thong */
      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, actorId)
        .input('khoa_ban_ghi', sql.VarChar(50), noteCode)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({
          noteCode,
          exportType: cleanExportType,
          lots: exportedSummary
        }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'DESTROY_OR_RETURN_EXPIRED_LOTS', 'tbl_phieu_xuat_kho', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({
        ok: true,
        noteCode,
        message: `Đã lập và duyệt Phiếu xuất hủy / trả NCC (${noteCode}) cho ${exportedSummary.length} lô thuốc thành công trên SQL Server!`
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
