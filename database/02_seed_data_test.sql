/* =========================================================================================
   HỆ THỐNG QUẢN LÝ NHÀ THUỐC ĐẠT CHUẨN GPP - NHÀ THUỐC MINH TIẾN
   FILE 02: DỮ LIỆU MẪU KIỂM THỬ (SEED DATA) CHO 3 THÀNH VIÊN PHỤ TRÁCH 3 MÀN HÌNH
   Bao phủ đầy đủ:
   - Màn 1 (Người 1): 5 thuốc (OTC & ETC), ma trận ĐVT 3 cấp, 8 lô thuốc đủ 5 màu cảnh báo hạn
   - Màn 2 (Người 2): 3 Nhà phân phối GDP, Phiếu nhập đã duyệt & Phiếu nhập chờ duyệt
   - Màn 3 (Người 3): Dữ liệu test tự động tách lô FEFO, thuốc kê đơn ETC, Hóa đơn POS mẫu
   ========================================================================================= */

USE MinhTienPharmacyGPP;
GO

SET NOCOUNT ON;
GO

-- =========================================================================================
-- 1. DỮ LIỆU BẢNG VAI TRÒ (tbl_vai_tro)
-- =========================================================================================
INSERT INTO tbl_vai_tro (ma_vai_tro, ten_vai_tro, cho_phep_sua_gia, cho_phep_duyet_kho, cho_phep_xem_doanh_thu, mo_ta_quyen)
VALUES
('ACT-01', N'Chủ nhà thuốc / Quản lý điều hành', 1, 1, 1, N'Toàn quyền cấu hình danh mục thuốc, đơn vị tính, khóa giá bán niêm yết và phê duyệt nhập/xuất kho.'),
('ACT-02', N'Dược sĩ bán lẻ tại quầy',           0, 0, 0, N'Thực hiện bán lẻ POS theo FEFO, tra cứu SOP, lập dự thảo phiếu nhập và kiểm nhập cảm quan ban đầu.');
GO

-- =========================================================================================
-- 2. DỮ LIỆU BẢNG NGƯỜI DÙNG (tbl_nguoi_dung)
-- =========================================================================================
SET IDENTITY_INSERT tbl_nguoi_dung ON;
INSERT INTO tbl_nguoi_dung (ma_nguoi_dung, ten_dang_nhap, mat_khau_hash, ho_va_ten, so_dien_thoai, ma_vai_tro, fcm_device_token, trang_thai)
VALUES
(1, 'chunhathuoc', 'ADMIN_123',  N'DSĐH. Nguyễn Minh Tiến', '0901234567', 'ACT-01', 'FCM_TOKEN_OWNER_ANDROID_01', 'ACTIVE'),
(2, 'duocsi01',    'STAFF_123',  N'DSTH. Trần Thị Mai',     '0912345678', 'ACT-02', NULL,                         'ACTIVE'),
(3, 'duocsi02',    'STAFF_456',  N'DSTH. Lê Hoàng Nam',     '0987654321', 'ACT-02', NULL,                         'ACTIVE');
SET IDENTITY_INSERT tbl_nguoi_dung OFF;
GO

-- =========================================================================================
-- 3. DỮ LIỆU BẢNG NHÀ CUNG CẤP ĐẠT CHUẨN GDP (tbl_nha_cung_cap_gdp)
-- =========================================================================================
INSERT INTO tbl_nha_cung_cap_gdp (ma_ncc, ten_nha_phan_phoi, ma_so_thue, so_chung_nhan_gdp, ngay_cap_gdp, ngay_het_han, trang_thai_gdp, so_dien_thoai, email, dia_chi)
VALUES
(N'NCC01', N'Công ty CP Dược phẩm Trung ương CPC1',            '0100109032', 'GDP-102/BYT', '2024-01-15', '2029-01-15', 'CON_HIEU_LUC', '02438254567', 'contact@cpc1.com.vn',    N'356A Giải Phóng, Thanh Xuân, Hà Nội'),
(N'NCC02', N'Công ty TNHH Dược phẩm Zuellig Pharma Việt Nam',  '0301449210', 'GDP-288/BYT', '2024-06-01', '2029-06-01', 'CON_HIEU_LUC', '02839102650', 'info@zuelligpharma.com', N'KCN Long Hậu, Cần Giuộc, Long An'),
(N'NCC03', N'Công ty TNHH Phân phối Dược phẩm Đông Đô (Test)', '0105998877', 'GDP-019/SYT', '2020-03-01', '2025-03-01', 'HET_HIEU_LUC', '02437765432', 'dongdopharma@gmail.com', N'Hoàng Mai, Hà Nội (Dùng để test chặn GDP hết hạn)');
GO

-- =========================================================================================
-- 4. DỮ LIỆU BẢNG DANH MỤC THUỐC ĐẠT CHUẨN GPP (tbl_dm_thuoc) - PHỤC VỤ MÀN 1 & MÀN 3
-- =========================================================================================
INSERT INTO tbl_dm_thuoc (ma_thuoc, ten_thuoc, hoat_chat, ham_luong, dang_bao_che, so_dang_ky, ma_vach_barcode, phan_loai_ke_don, don_vi_co_ban, ma_ncc, muc_ton_toi_thieu, vi_tri_tu_quay, ghi_chu_sop, trang_thai)
VALUES
(N'DRG01', N'Panadol Extra (Đỏ)', 
 N'Paracetamol 500mg + Caffeine 65mg', N'500mg/65mg', N'Viên nén bao phim', 'VD-21092-14', '8930001', 'OTC', N'Viên', N'NCC01', 100, N'Tủ A - Ngăn 1 (Hạ sốt, Giảm đau)',
 N'Hỏi kỹ khách hàng có tiền sử bệnh gan/thận hoặc đang uống thuốc cảm khác chứa Paracetamol không.|Liều dùng người lớn: Uống 1–2 viên/lần, cách nhau 4–6 giờ, không quá 8 viên/ngày.|Kiểm tra đúng lô FEFO trên vỉ thuốc trước khi giao khách.',
 'ACTIVE'),

(N'DRG02', N'Augmentin 625mg', 
 N'Amoxicillin 500mg + Acid Clavulanic 125mg', N'500mg/125mg', N'Viên nén bao phim', 'VN-19821-16', '8930002', 'ETC', N'Viên', N'NCC02', 28, N'Tủ B - Ngăn 2 (Kháng sinh Kê đơn)',
 N'[BẮT BUỘC THUỐC KÊ ĐƠN ETC]: Kiểm tra đơn thuốc hợp lệ của Bác sĩ và nhập tên Bác sĩ + Chẩn đoán.|Hỏi tiền sử dị ứng kháng sinh nhóm Penicillin / Cephalosporin.|Dặn khách uống đầu bữa ăn và uống đủ liều theo đơn bác sĩ.',
 'ACTIVE'),

(N'DRG03', N'Natri Clorid 0.9% Pharmedic', 
 N'Natri clorid 90mg/10ml', N'0.9% (10ml)', N'Dung dịch nhỏ mắt/mũi', 'VD-18290-13', '8930003', 'OTC', N'Lọ', N'NCC01', 30, N'Tủ C - Ngăn 1 (Nhỏ mắt, Sát khuẩn)',
 N'Thuốc nhỏ mắt/mũi sinh lý không kê đơn OTC.|Hướng dẫn khách không dùng chung lọ nhỏ mắt với người khác và dùng trong 15 ngày sau khi mở nắp.',
 'ACTIVE'),

(N'DRG04', N'Berberin BM 100mg', 
 N'Berberin clorid 100mg', N'100mg', N'Viên nén bao đường', 'VD-29102-18', '8930004', 'OTC', N'Viên', N'NCC01', 100, N'Tủ A - Ngăn 3 (Tiêu hóa)',
 N'Hỏi triệu chứng tiêu chảy, đau bụng và thời gian khởi phát.|Liều người lớn: Uống 1–2 viên/lần x 2 lần/ngày.|Tránh dùng đồng thời với phụ nữ có thai.',
 'ACTIVE'),

(N'DRG05', N'Klacid Forte 500mg', 
 N'Clarithromycin 500mg', N'500mg', N'Viên nén bao phim', 'VN-20415-17', '8930005', 'ETC', N'Viên', N'NCC02', 14, N'Tủ B - Ngăn 3 (Kháng sinh Kê đơn)',
 N'[BẮT BUỘC THUỐC KÊ ĐƠN ETC]: Yêu cầu xuất trình đơn thuốc Bác sĩ và nhập đầy đủ thông tin Bác sĩ, Chẩn đoán.|Hỏi tiền sử bệnh lý tim mạch hoặc dị ứng nhóm Macrolid.|Tư vấn uống nguyên viên, không nhai nát.',
 'ACTIVE');
GO

-- =========================================================================================
-- 5. DỮ LIỆU BẢNG QUY ĐỔI ĐƠN VỊ TÍNH 3 CẤP (tbl_quy_doi_don_vi)
-- =========================================================================================
INSERT INTO tbl_quy_doi_don_vi (ma_thuoc, ten_don_vi, ty_le_quy_doi, gia_ban_niem_yet, cap_don_vi, la_don_vi_xuat_hd)
VALUES
-- DRG01: Panadol Extra (1 Hộp = 15 Vỉ = 180 Viên)
(N'DRG01', N'Viên', 1,   2000,   1, 0),
(N'DRG01', N'Vỉ',   12,  22000,  2, 1),
(N'DRG01', N'Hộp',  180, 310000, 3, 0),

-- DRG02: Augmentin 625mg (1 Hộp = 2 Vỉ = 14 Viên)
(N'DRG02', N'Viên', 1,   15000,  1, 0),
(N'DRG02', N'Vỉ',   7,   100000, 2, 1),
(N'DRG02', N'Hộp',  14,  195000, 3, 0),

-- DRG03: Natri Clorid 0.9% (1 Thùng = 10 Lốc = 100 Lọ)
(N'DRG03', N'Lọ',    1,   5000,   1, 1),
(N'DRG03', N'Lốc',   10,  45000,  2, 0),
(N'DRG03', N'Thùng', 100, 420000, 3, 0),

-- DRG04: Berberin BM 100mg (1 Hộp = 10 Lọ = 1000 Viên)
(N'DRG04', N'Viên', 1,    500,    1, 0),
(N'DRG04', N'Lọ',   100,  42000,  2, 1),
(N'DRG04', N'Hộp',  1000, 400000, 3, 0),

-- DRG05: Klacid Forte 500mg (1 Hộp = 2 Vỉ = 14 Viên)
(N'DRG05', N'Viên', 1,  28000,  1, 0),
(N'DRG05', N'Vỉ',   7,  190000, 2, 1),
(N'DRG05', N'Hộp',  14, 370000, 3, 0);
GO

-- =========================================================================================
-- 6. DỮ LIỆU BẢNG LÔ THUỐC & HẠN DÙNG (tbl_lo_thuoc) - ĐỦ 5 NHÓM MÀU CẢNH BÁO
-- =========================================================================================
SET IDENTITY_INSERT tbl_lo_thuoc ON;
INSERT INTO tbl_lo_thuoc (ma_lo, ma_lo_hien_thi, ma_thuoc, so_lo, ngay_san_xuat, han_dung, ngay_nhap_kho, so_luong_ton, don_vi_co_ban, gia_von_nhap, trang_thai_lo)
VALUES
-- LO-01: Còn 19 ngày -> ĐỎ (CAN_HAN_30) - Sẽ được FEFO ưu tiên lấy trước cho DRG01
(1, 'LO-01', N'DRG01', N'PND-2409',  '2024-11-15', '2026-11-18', '2024-12-01', 30,  N'Viên', 1500,  'CAN_HAN_30'),

-- LO-02: Còn > 200 ngày -> XANH (KHA_DUNG) - Nếu khách mua > 30 viên DRG01, POS sẽ tự động tách LO-01 (30v) + LO-02
(2, 'LO-02', N'DRG01', N'PND-2506',  '2025-06-01', '2027-06-01', '2025-06-15', 360, N'Viên', 1550,  'KHA_DUNG'),

-- LO-03: Còn 67 ngày -> CAM (CAN_HAN_90) - Thuốc kê đơn ETC Augmentin
(3, 'LO-03', N'DRG02', N'AUG-2501',  '2025-01-10', '2027-01-05', '2025-02-01', 28,  N'Viên', 11500, 'CAN_HAN_90'),

-- LO-04: Còn 141 ngày -> VÀNG (CAN_HAN_180) - Natri Clorid 0.9%
(4, 'LO-04', N'DRG03', N'NAT-2503',  '2025-03-20', '2027-03-20', '2025-04-01', 55,  N'Lọ',   3200,  'CAN_HAN_180'),

-- LO-05: Đã quá hạn (2026-10-10) -> XÁM (KHOA_HET_HAN) - Dùng để test chặn bán 100% ở POS và Xuất hủy ở Màn 1
(5, 'LO-05', N'DRG01', N'PND-EXP01', '2024-05-01', '2026-10-10', '2024-05-20', 24,  N'Viên', 1450,  'KHOA_HET_HAN'),

-- LO-06: Lô thứ 2 của Augmentin (XANH) để test tách lô FEFO cho thuốc ETC
(6, 'LO-06', N'DRG02', N'AUG-2508',  '2025-08-01', '2027-08-15', '2025-08-20', 70,  N'Viên', 12000, 'KHA_DUNG'),

-- LO-07: Berberin BM 100mg (XANH)
(7, 'LO-07', N'DRG04', N'BER-2509',  '2025-09-01', '2027-09-10', '2025-09-15', 400, N'Viên', 350,   'KHA_DUNG'),

-- LO-08: Klacid Forte 500mg (ĐỎ <= 30 ngày)
(8, 'LO-08', N'DRG05', N'KLA-2411',  '2024-11-10', '2026-11-25', '2024-12-05', 14,  N'Viên', 22000, 'CAN_HAN_30');
SET IDENTITY_INSERT tbl_lo_thuoc OFF;
GO

-- =========================================================================================
-- 7. DỮ LIỆU BẢNG PHIẾU NHẬP KHO & CHI TIẾT (PHỤC VỤ NGƯỜI 2 - MÀN HÌNH 2)
-- =========================================================================================
SET IDENTITY_INSERT tbl_phieu_nhap_kho ON;
INSERT INTO tbl_phieu_nhap_kho (
    ma_phieu_nhap, so_phieu_nhap, ma_ncc, so_hoa_don_vat, ngay_hoa_don, file_chung_tu_url,
    ma_nhan_vien_lap, ma_quan_ly_duyet, kenh_phe_duyet,
    chk_bao_bi_nguyen_ven, chk_nhan_lo_hsd_khop, chk_nhiet_do_bao_quan,
    ly_do_dac_cach, tong_tien_nhap, trang_thai_nhap
)
VALUES
(1, 'PNK-202610-001', N'NCC01', 'HD-GTGT-0081120', '2026-10-15', N'hoadon_vat_0081120.pdf',
 2, 1, 'WEB_POS', 1, 1, 1, NULL, 1140000, 'DA_DUYET_NHAP'),

(2, 'PNK-202610-002', N'NCC02', 'HD-GTGT-0084921', '2026-10-29', N'hoadon_vat_0084921.pdf',
 2, NULL, NULL, 1, 1, 1, NULL, 725000, 'CHO_KIEM_NHAP');
SET IDENTITY_INSERT tbl_phieu_nhap_kho OFF;
GO

INSERT INTO tbl_ct_phieu_nhap (ma_phieu_nhap, ma_lo, ma_quy_doi, so_luong_nhap, so_luong_co_ban, don_gia_nhap, vat_phan_tram, dat_cam_quan_gpp, ghi_chu_han_gpp)
SELECT 1, 2, ma_quy_doi, 2, 360, 270000, 5, 1, N'Đạt chuẩn (>= 180 ngày)'
FROM tbl_quy_doi_don_vi WHERE ma_thuoc = N'DRG01' AND ten_don_vi = N'Hộp';

INSERT INTO tbl_ct_phieu_nhap (ma_phieu_nhap, ma_lo, ma_quy_doi, so_luong_nhap, so_luong_co_ban, don_gia_nhap, vat_phan_tram, dat_cam_quan_gpp, ghi_chu_han_gpp)
SELECT 2, 6, ma_quy_doi, 5, 70, 145000, 5, 1, N'Đạt chuẩn (>= 180 ngày)'
FROM tbl_quy_doi_don_vi WHERE ma_thuoc = N'DRG02' AND ten_don_vi = N'Hộp';
GO

-- =========================================================================================
-- 8. DỮ LIỆU BẢNG HÓA ĐƠN BÁN LẺ & CHI TIẾT (PHỤC VỤ NGƯỜI 3 - MÀN HÌNH 3 POS)
-- =========================================================================================
SET IDENTITY_INSERT tbl_hoa_don_ban_le ON;
INSERT INTO tbl_hoa_don_ban_le (
    ma_hoa_don, so_hoa_don, ma_nhan_vien, ten_khach_hang,
    ma_don_thuoc_etc, bac_si_ke_don, co_so_kham_benh, chan_doan_benh,
    tong_tien, tien_giam_gia, tong_thanh_toan, phuong_thuc_tt, ma_viet_qr, trang_thai
)
VALUES
-- Hóa đơn 1: Bán thuốc không kê đơn OTC (Thông tin bác sĩ để NULL)
(1, 'HD-POS-202610-001', 2, N'Khách lẻ vãng lai',
 NULL, NULL, NULL, NULL,
 49000, 0, 49000, 'TIEN_MAT', NULL, 'HOAN_TAT'),

-- Hóa đơn 2: Bán thuốc kê đơn ETC (Có đầy đủ Bác sĩ kê đơn & Chẩn đoán bệnh theo R05)
(2, 'HD-POS-202610-002', 2, N'Nguyễn Văn Hùng',
 'DT-BM-99201', N'BS.CKII Phạm Quốc Khánh', N'Bệnh viện Bạch Mai', N'Viêm amidan cấp mủ bội nhiễm',
 195000, 0, 195000, 'VIETQR', N'00020101021238570010A00000072701270006970407011319038889999990208QRIBFTTA530370454061950005802VN', 'HOAN_TAT');
SET IDENTITY_INSERT tbl_hoa_don_ban_le OFF;
GO

INSERT INTO tbl_ct_hoa_don (ma_hoa_don, ma_lo, so_luong_ban, don_vi_ban, so_luong_co_ban, don_gia_ban, thanh_tien)
VALUES
(1, 1, 2, N'Vỉ',  24, 22000,  44000),
(1, 4, 1, N'Lọ',  1,  5000,   5000),
(2, 3, 1, N'Hộp', 14, 195000, 195000);
GO

-- =========================================================================================
-- 9. DỮ LIỆU BẢNG PHIẾU XUẤT KHO PHI THƯƠNG MẠI (PHỤC VỤ NGƯỜI 1 - TAB 2 CẢNH BÁO HẠN)
-- =========================================================================================
SET IDENTITY_INSERT tbl_phieu_xuat_kho ON;
INSERT INTO tbl_phieu_xuat_kho (ma_phieu_xuat, so_phieu_xuat, loai_xuat, ma_nhan_vien_lap, ma_quan_ly_duyet, ly_do_xuat, trang_thai)
VALUES
(1, 'PXH-202610-001', 'XUAT_HUY_HET_HAN', 2, 1, N'Thu hồi đưa vào tủ biệt trữ chờ tiêu hủy đối với lô PND-EXP01 đã hết hạn sử dụng.', 'CHO_DUYET');
SET IDENTITY_INSERT tbl_phieu_xuat_kho OFF;
GO

INSERT INTO tbl_ct_phieu_xuat (ma_phieu_xuat, ma_lo, so_luong_xuat_co_ban, ghi_chu_kiem_soat)
VALUES
(1, 5, 24, N'Đã khóa cứng KHOA_HET_HAN, niêm phong tại tủ cách ly GPP.');
GO

-- =========================================================================================
-- 10. DỮ LIỆU BẢNG NHẬT KÝ HỆ THỐNG (tbl_nhat_ky_he_thong)
-- =========================================================================================
INSERT INTO tbl_nhat_ky_he_thong (ma_nguoi_dung, hanh_dong, bang_tac_dong, khoa_ban_ghi, du_lieu_cu_json, du_lieu_moi_json)
VALUES
(1, 'INIT_PRICE_MATRIX', 'tbl_quy_doi_don_vi', 'DRG01', NULL, N'{"Viên":2000,"Vỉ":22000,"Hộp":310000}'),
(1, 'AUTO_LOCK_EXPIRED', 'tbl_lo_thuoc',       'LO-05', N'{"trang_thai_lo":"CAN_HAN_30"}', N'{"trang_thai_lo":"KHOA_HET_HAN"}');
GO
