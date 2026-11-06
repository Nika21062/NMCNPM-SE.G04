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
  const { barcode, name, ingredient, sdk, type, minStock, units, userId } = req.body;
  if (!barcode || !name || !ingredient || !sdk || !Array.isArray(units) || units.length === 0) {
    return res.status(400).json({ ok: false, message: 'ERR_MISSING_GPP_FIELDS: Vui lòng nhập đủ thông tin định danh thuốc và đơn vị tính!' });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Kiểm tra quyền cho_phep_sua_gia trong bảng tbl_vai_tro (không dùng userId mặc định) */
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

      /* Kiểm tra tính hợp lệ và không trùng tên đơn vị tính trong mảng units */
      const seenUnitNames = new Set();
      for (const u of units) {
        const cleanUName = String(u.unitName || '').trim().toLowerCase();
        if (!cleanUName || Number(u.rate) < 1 || Number(u.price) <= 0) {
          throw new Error('ERR_INVALID_UNIT_RATE: Tên đơn vị tính không được để trống, tỷ lệ quy đổi >= 1 và giá bán niêm yết > 0!');
        }
        if (seenUnitNames.has(cleanUName)) {
          throw new Error(`ERR_DUPLICATE_UNIT_NAME: Tên đơn vị tính "${u.unitName}" bị lặp lại nhiều lần trong cùng một thuốc!`);
        }
        seenUnitNames.add(cleanUName);
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

      /* Lưu thông tin định danh thuốc vào bảng tbl_dm_thuoc */
      await new sql.Request(transaction)
        .input('ma_thuoc', sql.NVarChar(20), newDrugId)
        .input('ten_thuoc', sql.NVarChar(300), name.trim())
        .input('hoat_chat', sql.NVarChar(200), ingredient.trim())
        .input('so_dang_ky', sql.VarChar(50), sdk.trim())
        .input('ma_vach_barcode', sql.VarChar(50), barcode.trim())
        .input('phan_loai_ke_don', sql.VarChar(10), type || 'OTC')
        .input('don_vi_co_ban', sql.NVarChar(30), baseUnitName)
        .input('muc_ton_toi_thieu', sql.Int, Number(minStock || 50))
        .input('ghi_chu_sop', sql.NVarChar(sql.MAX), 'Tư vấn đúng liều lượng và kiểm tra hạn dùng lô FEFO trước khi xuất bán.')
        .query(`
          INSERT INTO tbl_dm_thuoc (ma_thuoc, ten_thuoc, hoat_chat, so_dang_ky, ma_vach_barcode, phan_loai_ke_don, don_vi_co_ban, muc_ton_toi_thieu, ghi_chu_sop)
          VALUES (@ma_thuoc, @ten_thuoc, @hoat_chat, @so_dang_ky, @ma_vach_barcode, @phan_loai_ke_don, @don_vi_co_ban, @muc_ton_toi_thieu, @ghi_chu_sop)
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

/* Hàm API POST /xuat-huy: Lập phiếu xuất hủy / trả NCC cho các lô thuốc quá hạn hoặc nguy cấp (<= 30 ngày) */
router.post('/xuat-huy', async (req, res) => {
  const { exportType, reason, lotIds, userId } = req.body;
  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Xuất hủy / trả NCC làm giảm tồn kho nên chỉ tài khoản có quyền cho_phep_duyet_kho (Chủ nhà thuốc) được ký duyệt */
      const actor = await requireUser(transaction, userId, 'cho_phep_duyet_kho', 'ký duyệt phiếu xuất hủy / trả NCC');
      const actorId = actor.ma_nguoi_dung;
      const noteCode = 'PXH-' + Date.now().toString().slice(-8);
      const cleanExportType = exportType || 'XUAT_HUY_HET_HAN';
      const targetLotStatus = cleanExportType === 'XUAT_TRA_NCC' ? 'XUAT_TRA_NCC' : 'XUAT_HUY';

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

      if (Array.isArray(lotIds)) {
        for (const lotCode of lotIds) {
          const lotRes = await new sql.Request(transaction)
            .input('ma_lo_hien_thi', sql.VarChar(20), String(lotCode))
            .query(`
              SELECT TOP 1 ma_lo, so_lo, so_luong_ton, trang_thai_lo
              FROM tbl_lo_thuoc WITH (UPDLOCK, ROWLOCK)
              WHERE (ma_lo_hien_thi = @ma_lo_hien_thi OR CAST(ma_lo AS VARCHAR(20)) = @ma_lo_hien_thi)
                AND so_luong_ton > 0;
            `);

          const row = lotRes.recordset[0];
          if (row) {
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

                UPDATE tbl_phieu_xuat_kho
                SET trang_thai = 'DA_DUYET'
                WHERE trang_thai = 'CHO_DUYET'
                  AND ma_phieu_xuat IN (SELECT ma_phieu_xuat FROM tbl_ct_phieu_xuat WHERE ma_lo = @ma_lo);
              `);

            exportedSummary.push({
              ma_lo: row.ma_lo,
              so_lo: row.so_lo,
              exportedBaseQty: Number(row.so_luong_ton),
              oldStatus: row.trang_thai_lo,
              newStatus: targetLotStatus
            });
          }
        }
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
