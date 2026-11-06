/* ============================================================================
   API ĐỊNH TUYẾN MÀN HÌNH 1: BÁN LẺ QUẦY POS - FEFO, SOP & VIETQR
   File: backend/routes/ban-le-pos.routes.js
   Chức năng: Truy vấn danh sách sản phẩm từ DB, tìm kiếm theo tên, phân bổ lô
   tự động theo thuật toán FEFO và thực thi Transaction thanh toán trừ kho ACID
   ============================================================================ */

const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');
const { requireUser } = require('../utils/permission');

/* Hàm API GET /data: Lấy toàn bộ danh sách sản phẩm, ĐVT, quy trình SOP và các lô thuốc FEFO từ SQL Server */
router.get('/data', async (req, res) => {
  try {
    const pool = await getPool();
    const searchKeyword = (req.query.search || '').trim();

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

    /* Truy vấn bảng tbl_dm_thuoc lấy toàn bộ sản phẩm đang hoạt động (hoặc lọc theo tên sản phẩm nếu có tham số search) */
    const drugReq = pool.request();
    let drugQuery = `
      SELECT ma_thuoc, ten_thuoc, hoat_chat, ham_luong, dang_bao_che,
             so_dang_ky, ma_vach_barcode, phan_loai_ke_don, don_vi_co_ban,
             muc_ton_toi_thieu, vi_tri_tu_quay, ghi_chu_sop
      FROM tbl_dm_thuoc
      WHERE ISNULL(trang_thai, 'ACTIVE') = 'ACTIVE'
    `;
    if (searchKeyword) {
      drugReq.input('ten_tk', sql.NVarChar(300), `%${searchKeyword}%`);
      drugQuery += ` AND ten_thuoc LIKE @ten_tk `;
    }
    drugQuery += ` ORDER BY ma_thuoc ASC; `;

    const drugsRes = await drugReq.query(drugQuery);

    /* Truy vấn bảng tbl_quy_doi_don_vi lấy danh sách đơn vị tính và đơn giá niêm yết khóa cứng */
    const unitsRes = await pool.request().query(`
      SELECT ma_quy_doi, ma_thuoc, ten_don_vi, ty_le_quy_doi, gia_ban_niem_yet, cap_don_vi, la_don_vi_xuat_hd
      FROM tbl_quy_doi_don_vi
      ORDER BY ma_thuoc ASC, ty_le_quy_doi ASC;
    `);

    /* Truy vấn View vw_lo_thuoc_fefo lấy danh sách lô sắp xếp ưu tiên hạn dùng gần nhất (FEFO) */
    const lotsRes = await pool.request().query(`
      SELECT ma_lo, ma_lo_hien_thi, ma_thuoc, so_lo,
             CONVERT(VARCHAR(10), ngay_san_xuat, 23) AS ngay_san_xuat,
             CONVERT(VARCHAR(10), han_dung, 23) AS han_dung,
             so_luong_ton, don_vi_co_ban, trang_thai_lo,
             so_ngay_con_lai, ma_mau_canh_bao, cho_phep_xuat_fefo
      FROM vw_lo_thuoc_fefo
      ORDER BY han_dung ASC, ngay_nhap_kho ASC, ma_lo ASC;
    `);

    /* Ánh xạ dữ liệu thuốc và gắn kèm mảng đơn vị tính */
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
        minStock: d.muc_ton_toi_thieu,
        shelfLocation: d.vi_tri_tu_quay || 'Tủ A - Quầy bán lẻ',
        sop: d.ghi_chu_sop
          ? d.ghi_chu_sop.split('|')
          : ['Tư vấn đúng liều lượng và kiểm tra hạn dùng lô FEFO trước khi xuất bán.'],
        units: mappedUnits.length > 0
          ? mappedUnits
          : [{ id: 0, unitName: d.don_vi_co_ban || 'Viên', rate: 1, price: 0, level: 1, isDefaultSale: true }]
      };
    });

    /* Ánh xạ dữ liệu lô thuốc và trạng thái cảnh báo màu hạn dùng */
    const lots = lotsRes.recordset.map(l => ({
      dbId: Number(l.ma_lo),
      lotId: l.ma_lo_hien_thi,
      drugId: l.ma_thuoc,
      batchNo: l.so_lo,
      mfg: l.ngay_san_xuat,
      exp: l.han_dung,
      baseQty: Number(l.so_luong_ton),
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

/* Danh sách trạng thái lô được phép xuất bán thương mại (khớp View vw_lo_thuoc_fefo) */
const SELLABLE_LOT_STATUSES = ['KHA_DUNG', 'CAN_HAN_180', 'CAN_HAN_90', 'CAN_HAN_60', 'CAN_HAN_30'];

/* Hàm isLotSellable: Kiểm tra một lô có được phép xuất bán hay không */
function isLotSellable(lotRow) {
  return (
    SELLABLE_LOT_STATUSES.includes(lotRow.trang_thai_lo) &&
    Number(lotRow.so_ngay_con_lai) > 0 &&
    Number(lotRow.so_luong_ton) > 0
  );
}

/* Hàm allocateFefo (Service Function): Phân bổ số lượng cơ bản cần bán vào các lô theo FEFO.
   Đầu vào: danh sách lô đã sắp xếp theo hạn dùng tăng dần, số lượng cơ bản cần lấy.
   Đầu ra: { ok, totalAvail, allocations: [{ lot, takeBase }] } - hàm thuần, dễ viết Unit Test */
function allocateFefo(sortedLots, neededBaseQty) {
  const eligible = sortedLots.filter(isLotSellable);
  const totalAvail = eligible.reduce((sum, l) => sum + Number(l.so_luong_ton), 0);
  if (neededBaseQty > totalAvail) {
    return { ok: false, totalAvail, allocations: [] };
  }
  let remaining = neededBaseQty;
  const allocations = [];
  for (const lot of eligible) {
    if (remaining <= 0) break;
    const takeBase = Math.min(Number(lot.so_luong_ton), remaining);
    allocations.push({ lot, takeBase });
    remaining -= takeBase;
  }
  return { ok: true, totalAvail, allocations };
}

/* Hàm API POST /thanh-toan: Xác nhận thanh toán đơn hàng POS.
   - Server tự tra giá niêm yết và tỷ lệ quy đổi từ tbl_quy_doi_don_vi (không tin giá client gửi lên)
   - Server tự khóa dòng (UPDLOCK, ROWLOCK) và phân bổ lô theo FEFO (không tin phân bổ lô client gửi lên)
   - Bắt buộc đủ 4 trường đơn thuốc nếu giỏ hàng có thuốc ETC */
router.post('/thanh-toan', async (req, res) => {
  const {
    customerName,
    payMethod,
    etcCode,
    etcDoctor,
    etcClinic,
    etcDiagnosis,
    items,
    userId
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, message: 'Giỏ hàng đang trống, vui lòng thêm sản phẩm trước khi thanh toán!' });
  }

  const cleanPayMethod = payMethod || 'TIEN_MAT';
  if (!['TIEN_MAT', 'VIETQR', 'THE'].includes(cleanPayMethod)) {
    return res.status(400).json({ ok: false, message: `Phương thức thanh toán "${payMethod}" không hợp lệ!` });
  }

  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      /* Bắt buộc tài khoản đăng nhập hợp lệ (Dược sĩ hoặc Chủ nhà thuốc đều được bán hàng) */
      const seller = await requireUser(transaction, userId, null, 'bán hàng tại quầy POS');
      const validUserId = seller.ma_nguoi_dung;

      const etc = {
        code: String(etcCode || '').trim(),
        doctor: String(etcDoctor || '').trim(),
        clinic: String(etcClinic || '').trim(),
        diagnosis: String(etcDiagnosis || '').trim()
      };

      /* BƯỚC 1: Kiểm tra dữ liệu từng dòng giỏ hàng, tra giá niêm yết và tỷ lệ quy đổi từ CSDL */
      const pricedLines = [];
      let hasEtc = false;
      for (const item of items) {
        const qty = Number(item.qty);
        if (!item.drugId || !item.unitName || !Number.isInteger(qty) || qty <= 0) {
          throw new Error('Dòng giỏ hàng không hợp lệ: thiếu mã thuốc, đơn vị tính hoặc số lượng phải là số nguyên > 0!');
        }

        const uRes = await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), item.drugId)
          .input('ten_don_vi', sql.NVarChar(50), item.unitName)
          .query(`
            SELECT d.ten_thuoc, d.phan_loai_ke_don, d.don_vi_co_ban, d.trang_thai,
                   q.ty_le_quy_doi, q.gia_ban_niem_yet
            FROM tbl_dm_thuoc d
            LEFT JOIN tbl_quy_doi_don_vi q ON d.ma_thuoc = q.ma_thuoc AND q.ten_don_vi = @ten_don_vi
            WHERE d.ma_thuoc = @ma_thuoc;
          `);
        const info = uRes.recordset[0];
        if (!info || (info.trang_thai && info.trang_thai !== 'ACTIVE')) {
          throw new Error(`Thuốc ${item.drugId} không tồn tại hoặc đã ngừng kinh doanh!`);
        }
        if (info.ty_le_quy_doi == null || info.gia_ban_niem_yet == null) {
          throw new Error(`Thuốc ${info.ten_thuoc} chưa được cấu hình đơn vị "${item.unitName}" và giá bán niêm yết!`);
        }
        if (info.phan_loai_ke_don === 'ETC') hasEtc = true;

        const rate = Number(info.ty_le_quy_doi);
        const price = Number(info.gia_ban_niem_yet);
        pricedLines.push({
          drugId: item.drugId,
          drugName: info.ten_thuoc,
          baseUnit: info.don_vi_co_ban || 'Viên',
          unitName: item.unitName,
          qty,
          rate,
          price,
          neededBase: qty * rate,
          lineMoney: qty * price,
          clientAllocations: Array.isArray(item.allocations) ? item.allocations : []
        });
      }

      /* Kiểm tra bắt buộc đủ 4 trường đơn thuốc nếu có thuốc kê đơn ETC trong giỏ (R05) */
      if (hasEtc && (!etc.code || !etc.doctor || !etc.clinic || !etc.diagnosis)) {
        throw new Error('Đơn hàng có thuốc kê đơn ETC, bắt buộc nhập đủ: Mã đơn thuốc, Bác sĩ kê đơn, Cơ sở khám bệnh và Chẩn đoán bệnh!');
      }

      /* Tổng tiền do server tự tính theo giá niêm yết trong CSDL */
      const grandTotal = pricedLines.reduce((sum, l) => sum + l.lineMoney, 0);

      const invoiceCode = 'HD-POS-' + Date.now().toString().slice(-8);
      const qrString = cleanPayMethod === 'VIETQR'
        ? `00020101021238570010A00000072701270006970407011319038889999990208QRIBFTTA5303704540${grandTotal}5802VN`
        : null;

      /* BƯỚC 2: Lưu bản ghi Hóa đơn bán lẻ vào bảng tbl_hoa_don_ban_le */
      const hdRes = await new sql.Request(transaction)
        .input('so_hoa_don', sql.VarChar(30), invoiceCode)
        .input('ma_nhan_vien', sql.Int, validUserId)
        .input('ten_khach_hang', sql.NVarChar(100), customerName || 'Khách lẻ vãng lai')
        .input('ma_don_thuoc_etc', sql.VarChar(50), hasEtc ? etc.code : null)
        .input('bac_si_ke_don', sql.NVarChar(150), hasEtc ? etc.doctor : null)
        .input('co_so_kham_benh', sql.NVarChar(200), hasEtc ? etc.clinic : null)
        .input('chan_doan_benh', sql.NVarChar(300), hasEtc ? etc.diagnosis : null)
        .input('tong_tien', sql.Decimal(18, 2), grandTotal)
        .input('tong_thanh_toan', sql.Decimal(18, 2), grandTotal)
        .input('phuong_thuc_tt', sql.VarChar(20), cleanPayMethod)
        .input('ma_viet_qr', sql.NVarChar(500), qrString)
        .query(`
          INSERT INTO tbl_hoa_don_ban_le (
            so_hoa_don, ma_nhan_vien, ten_khach_hang,
            ma_don_thuoc_etc, bac_si_ke_don, co_so_kham_benh, chan_doan_benh,
            tong_tien, tien_giam_gia, tong_thanh_toan, phuong_thuc_tt, ma_viet_qr, trang_thai
          )
          VALUES (
            @so_hoa_don, @ma_nhan_vien, @ten_khach_hang,
            @ma_don_thuoc_etc, @bac_si_ke_don, @co_so_kham_benh, @chan_doan_benh,
            @tong_tien, 0, @tong_thanh_toan, @phuong_thuc_tt, @ma_viet_qr, 'HOAN_TAT'
          );
          SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ma_hoa_don;
        `);
      const maHoaDon = hdRes.recordset[0].ma_hoa_don;

      /* BƯỚC 3: Với từng dòng hàng, khóa dòng các lô của thuốc và phân bổ FEFO ngay trên server */
      const receiptLines = [];
      for (const line of pricedLines) {
        const lotsRes = await new sql.Request(transaction)
          .input('ma_thuoc', sql.NVarChar(20), line.drugId)
          .query(`
            SELECT ma_lo, so_lo, so_luong_ton, trang_thai_lo, so_ngay_con_lai,
                   CONVERT(VARCHAR(10), han_dung, 23) AS han_dung
            FROM tbl_lo_thuoc WITH (UPDLOCK, ROWLOCK)
            WHERE ma_thuoc = @ma_thuoc
            ORDER BY han_dung ASC, ngay_nhap_kho ASC, ma_lo ASC;
          `);
        const drugLots = lotsRes.recordset;

        /* Nếu client có chỉ định lô cụ thể mà lô đó bị khóa / hết hạn / chờ duyệt thì chặn bán */
        for (const a of line.clientAllocations) {
          if (!a || !a.dbId) continue;
          const pickedLot = drugLots.find(l => Number(l.ma_lo) === Number(a.dbId));
          if (pickedLot && !isLotSellable(pickedLot)) {
            throw new Error(`Lô ${pickedLot.so_lo} đang ở trạng thái ${pickedLot.trang_thai_lo} (hoặc đã hết hạn / hết hàng), cấm xuất bán!`);
          }
        }

        const fefo = allocateFefo(drugLots, line.neededBase);
        if (!fefo.ok) {
          throw new Error(`Thuốc ${line.drugName} không đủ tồn kho khả dụng (Cần ${line.neededBase} ${line.baseUnit}, còn ${fefo.totalAvail} ${line.baseUnit})!`);
        }

        let accumulatedMoney = 0;
        const lotsText = [];
        for (let idx = 0; idx < fefo.allocations.length; idx++) {
          const { lot, takeBase } = fefo.allocations[idx];
          const isLast = idx === fefo.allocations.length - 1;

          /* Trừ số lượng tồn kho cơ bản trên bảng tbl_lo_thuoc (Trigger trg_check_ton_kho_am chặn âm kho) */
          await new sql.Request(transaction)
            .input('ma_lo', sql.BigInt, lot.ma_lo)
            .input('take_base', sql.Int, takeBase)
            .query(`
              UPDATE tbl_lo_thuoc
              SET so_luong_ton = so_luong_ton - @take_base
              WHERE ma_lo = @ma_lo;
            `);
          /* Cập nhật tồn trong bộ nhớ để dòng hàng sau (cùng thuốc, khác ĐVT) phân bổ đúng */
          lot.so_luong_ton = Number(lot.so_luong_ton) - takeBase;

          /* Thành tiền chia theo tỷ lệ số lượng cơ bản; dòng cuối nhận phần còn lại để tổng khớp tuyệt đối */
          const thanhTien = isLast
            ? line.lineMoney - accumulatedMoney
            : Math.round((takeBase / line.neededBase) * line.lineMoney);
          accumulatedMoney += thanhTien;

          let soLuongBan;
          let donViBan;
          let donGiaBan;
          if (takeBase % line.rate === 0) {
            soLuongBan = takeBase / line.rate;
            donViBan = line.unitName;
            donGiaBan = line.price;
          } else {
            soLuongBan = takeBase;
            donViBan = line.baseUnit;
            donGiaBan = Math.max(0.01, Number((line.price / line.rate).toFixed(2)));
          }

          /* Lưu chi tiết từng dòng xuất lô FEFO vào bảng tbl_ct_hoa_don */
          await new sql.Request(transaction)
            .input('ma_hoa_don', sql.BigInt, maHoaDon)
            .input('ma_lo', sql.BigInt, lot.ma_lo)
            .input('so_luong_ban', sql.Int, soLuongBan)
            .input('don_vi_ban', sql.NVarChar(50), donViBan)
            .input('so_luong_co_ban', sql.Int, takeBase)
            .input('don_gia_ban', sql.Decimal(18, 2), donGiaBan)
            .input('thanh_tien', sql.Decimal(18, 2), thanhTien)
            .query(`
              INSERT INTO tbl_ct_hoa_don (
                ma_hoa_don, ma_lo, so_luong_ban, don_vi_ban, so_luong_co_ban, don_gia_ban, thanh_tien
              )
              VALUES (
                @ma_hoa_don, @ma_lo, @so_luong_ban, @don_vi_ban, @so_luong_co_ban, @don_gia_ban, @thanh_tien
              );
            `);

          lotsText.push(`${lot.so_lo} (HSD:${lot.han_dung}, -${takeBase} ${line.baseUnit})`);
        }

        receiptLines.push({
          name: line.drugName,
          qty: line.qty,
          unitName: line.unitName,
          price: line.price,
          lineMoney: line.lineMoney,
          lotsText: lotsText.join(', ')
        });
      }

      /* Ghi nhận vào bảng Nhật ký kiểm toán hệ thống tbl_nhat_ky_he_thong */
      await new sql.Request(transaction)
        .input('ma_nguoi_dung', sql.Int, validUserId)
        .input('khoa_ban_ghi', sql.VarChar(50), invoiceCode)
        .input('du_lieu_moi_json', sql.NVarChar(sql.MAX), JSON.stringify({
          invoiceCode,
          grandTotal,
          payMethod: cleanPayMethod,
          etcCode: hasEtc ? etc.code : null,
          etcDoctor: hasEtc ? etc.doctor : null,
          itemCount: pricedLines.length
        }))
        .query(`
          INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_moi_json)
          VALUES (@ma_nguoi_dung, 'POS_CHECKOUT_FEFO', 'tbl_hoa_don_ban_le', @khoa_ban_ghi, @du_lieu_moi_json);
        `);

      await transaction.commit();
      res.json({
        ok: true,
        invoiceCode,
        grandTotal,
        lines: receiptLines,
        message: `THANH TOÁN & IN BILL K80 THÀNH CÔNG (${invoiceCode}): Đã khóa dòng (UPDLOCK) và trừ tồn kho FEFO trên SQL Server!`
      });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

/* Xuất thêm hàm allocateFefo để phục vụ kiểm thử đơn vị (Unit Test) */
router.allocateFefo = allocateFefo;

module.exports = router;
