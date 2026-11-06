/* =========================================================================================
   HỆ THỐNG QUẢN LÝ NHÀ THUỐC ĐẠT CHUẨN GPP - NHÀ THUỐC MINH TIẾN
   FILE 01: KỊCH BẢN KHỞI TẠO CƠ SỞ DỮ LIỆU CHUẨN 3NF (ĐÃ ĐỒNG BỘ 100% VỚI 3 MÀN HÌNH UI)
   Hệ quản trị: Microsoft SQL Server (Docker / Local)
   ========================================================================================= */

USE master;
GO

IF DB_ID('MinhTienPharmacyGPP') IS NOT NULL
BEGIN
    ALTER DATABASE MinhTienPharmacyGPP SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE MinhTienPharmacyGPP;
END
GO

CREATE DATABASE MinhTienPharmacyGPP;
GO

USE MinhTienPharmacyGPP;
GO

-- =========================================================================================
-- 1. BẢNG VAI TRÒ VÀ PHÂN QUYỀN TRUY CẬP (RBAC)
-- =========================================================================================
CREATE TABLE tbl_vai_tro (
    ma_vai_tro              VARCHAR(20)   NOT NULL,
    ten_vai_tro             NVARCHAR(100) NOT NULL,
    cho_phep_sua_gia        BIT           NOT NULL DEFAULT 0,
    cho_phep_duyet_kho      BIT           NOT NULL DEFAULT 0,
    cho_phep_xem_doanh_thu  BIT           NOT NULL DEFAULT 0,
    mo_ta_quyen             NVARCHAR(255) NULL,
    CONSTRAINT pk_vai_tro PRIMARY KEY (ma_vai_tro)
);
GO

-- =========================================================================================
-- 2. BẢNG TÀI KHOẢN NGƯỜI DÙNG VÀ NHÂN VIÊN
-- =========================================================================================
CREATE TABLE tbl_nguoi_dung (
    ma_nguoi_dung           INT IDENTITY(1,1) NOT NULL,
    ten_dang_nhap           VARCHAR(50)   NOT NULL UNIQUE,
    mat_khau_hash           VARCHAR(255)  NOT NULL,
    ho_va_ten               NVARCHAR(100) NOT NULL,
    so_dien_thoai           VARCHAR(15)   NULL,
    ma_vai_tro              VARCHAR(20)   NOT NULL,
    fcm_device_token        VARCHAR(255)  NULL,
    trang_thai              VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT pk_nguoi_dung PRIMARY KEY (ma_nguoi_dung),
    CONSTRAINT fk_nguoi_dung_vai_tro FOREIGN KEY (ma_vai_tro) 
        REFERENCES tbl_vai_tro(ma_vai_tro)
);
GO

-- =========================================================================================
-- 3. BẢNG NHÀ CUNG CẤP / PHÂN PHỐI ĐẠT CHUẨN GDP
-- =========================================================================================
CREATE TABLE tbl_nha_cung_cap_gdp (
    ma_ncc                  NVARCHAR(20)  NOT NULL,
    ten_nha_phan_phoi       NVARCHAR(255) NOT NULL,
    ma_so_thue              VARCHAR(15)   NOT NULL UNIQUE,
    so_chung_nhan_gdp       VARCHAR(50)   NOT NULL,
    ngay_cap_gdp            DATE          NOT NULL,
    ngay_het_han            DATE          NULL,
    trang_thai_gdp          VARCHAR(20)   NOT NULL DEFAULT 'CON_HIEU_LUC',
    so_dien_thoai           VARCHAR(20)   NULL,
    email                   VARCHAR(100)  NULL,
    dia_chi                 NVARCHAR(300) NULL,
    CONSTRAINT pk_nha_cung_cap_gdp PRIMARY KEY (ma_ncc),
    CONSTRAINT ck_gdp_date CHECK (ngay_het_han IS NULL OR ngay_het_han > ngay_cap_gdp),
    CONSTRAINT ck_gdp_status CHECK (trang_thai_gdp IN ('CON_HIEU_LUC', 'HET_HIEU_LUC'))
);
GO

-- =========================================================================================
-- 4. BẢNG DANH MỤC THUỐC ĐẠT CHUẨN GPP (MÀN HÌNH 1 - UC-01)
-- [Đã fix]: Cho phép ma_ncc NULL để tạo mới thuốc trên Modal UC-01 không bị chặn
-- =========================================================================================
CREATE TABLE tbl_dm_thuoc (
    ma_thuoc                NVARCHAR(20)  NOT NULL,
    ten_thuoc               NVARCHAR(300) NOT NULL,
    hoat_chat               NVARCHAR(200) NOT NULL,
    ham_luong               NVARCHAR(100) NULL,
    dang_bao_che            NVARCHAR(100) NULL,
    so_dang_ky              VARCHAR(50)   NOT NULL UNIQUE,
    ma_vach_barcode         VARCHAR(50)   NOT NULL UNIQUE,
    phan_loai_ke_don        VARCHAR(10)   NOT NULL DEFAULT 'OTC',
    don_vi_co_ban           NVARCHAR(30)  NOT NULL DEFAULT N'Viên',
    ma_ncc                  NVARCHAR(20)  NULL,
    muc_ton_toi_thieu       INT           NOT NULL DEFAULT 50,
    vi_tri_tu_quay          NVARCHAR(50)  NULL,
    ghi_chu_sop             NVARCHAR(MAX) NULL, -- Lưu các bước SOP ngăn cách bởi dấu | hoặc JSON
    trang_thai              VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT pk_dm_thuoc PRIMARY KEY (ma_thuoc),
    CONSTRAINT fk_dm_thuoc_ncc FOREIGN KEY (ma_ncc) 
        REFERENCES tbl_nha_cung_cap_gdp(ma_ncc) ON UPDATE CASCADE,
    CONSTRAINT ck_phan_loai CHECK (phan_loai_ke_don IN ('ETC', 'OTC')),
    CONSTRAINT ck_ton_toi_thieu CHECK (muc_ton_toi_thieu >= 0)
);
GO

-- =========================================================================================
-- 5. BẢNG LÔ THUỐC VÀ HẠN DÙNG (MÀN HÌNH 1, 2, 3 - UC-02, UC-03, UC-05)
-- [Đã fix]: Thêm kiểm tra ngay_san_xuat < han_dung
-- =========================================================================================
CREATE TABLE tbl_lo_thuoc (
    ma_lo                   BIGINT IDENTITY(1,1) NOT NULL,
    ma_lo_hien_thi          VARCHAR(20)   NULL,     -- Mã hiển thị trên UI (VD: LO-01, LO-02)
    ma_thuoc                NVARCHAR(20)  NOT NULL,
    so_lo                   NVARCHAR(50)  NOT NULL,
    han_dung                DATE          NOT NULL,
    ngay_san_xuat           DATE          NULL,
    ngay_nhap_kho           DATE          NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    so_luong_ton            INT           NOT NULL DEFAULT 0, -- Luôn lưu theo ĐVT cơ bản nhỏ nhất
    don_vi_co_ban           NVARCHAR(30)  NOT NULL,
    gia_von_nhap            DECIMAL(18,2) NOT NULL DEFAULT 0,
    trang_thai_lo           VARCHAR(20)   NOT NULL DEFAULT 'KHA_DUNG',
    so_ngay_con_lai         AS (DATEDIFF(day, CAST(GETDATE() AS DATE), han_dung)),
    CONSTRAINT pk_lo_thuoc PRIMARY KEY (ma_lo),
    CONSTRAINT uq_lo_thuoc_so_lo UNIQUE (ma_thuoc, so_lo, han_dung),
    CONSTRAINT fk_lo_thuoc_dm FOREIGN KEY (ma_thuoc) REFERENCES tbl_dm_thuoc(ma_thuoc),
    CONSTRAINT ck_han_dung_nhap CHECK (han_dung > ngay_nhap_kho),
    CONSTRAINT ck_nsx_hsd CHECK (ngay_san_xuat IS NULL OR ngay_san_xuat < han_dung),
    CONSTRAINT ck_so_luong_ton CHECK (so_luong_ton >= 0),
    CONSTRAINT ck_trang_thai_lo CHECK (trang_thai_lo IN (
        'CHO_DUYET_NHAP', 'KHA_DUNG', 'CAN_HAN_30', 'CAN_HAN_60', 'CAN_HAN_90',
        'CAN_HAN_180', 'KHOA_HET_HAN', 'XUAT_HUY', 'XUAT_TRA_NCC'
    ))
);
GO

-- =========================================================================================
-- 6. BẢNG QUY ĐỔI ĐƠN VỊ TÍNH VÀ GIÁ BÁN NIÊM YẾT (MÀN HÌNH 1, 2, 3)
-- [Đã fix]: Đổi UNIQUE sang (ma_thuoc, ten_don_vi) để hỗ trợ "+ Thêm nhanh quy cách ĐVT"
-- =========================================================================================
CREATE TABLE tbl_quy_doi_don_vi (
    ma_quy_doi              BIGINT IDENTITY(1,1) NOT NULL,
    ma_thuoc                NVARCHAR(20)  NOT NULL,
    ten_don_vi              NVARCHAR(50)  NOT NULL,
    ty_le_quy_doi           INT           NOT NULL,
    gia_ban_niem_yet        DECIMAL(18,2) NOT NULL,
    cap_don_vi              TINYINT       NOT NULL DEFAULT 1, -- 1: Cơ bản, 2: Trung gian, 3+: Chẵn/Hộp
    la_don_vi_xuat_hd       BIT           NOT NULL DEFAULT 0,
    CONSTRAINT pk_quy_doi_don_vi PRIMARY KEY (ma_quy_doi),
    CONSTRAINT fk_quy_doi_dm FOREIGN KEY (ma_thuoc) 
        REFERENCES tbl_dm_thuoc(ma_thuoc) ON DELETE CASCADE,
    CONSTRAINT ck_ty_le_quy_doi CHECK (ty_le_quy_doi >= 1),
    CONSTRAINT ck_gia_niem_yet CHECK (gia_ban_niem_yet > 0),
    CONSTRAINT ck_cap_don_vi CHECK (cap_don_vi >= 1),
    CONSTRAINT uq_thuoc_ten_dv UNIQUE (ma_thuoc, ten_don_vi)
);
GO

-- =========================================================================================
-- 7. BẢNG PHIẾU NHẬP KHO THEO LÔ (MÀN HÌNH 2 - UC-02)
-- [Đã fix]: Bổ sung 3 cờ Checklist cảm quan GPP, lý do đặc cách và đồng bộ trạng thái UI
-- =========================================================================================
CREATE TABLE tbl_phieu_nhap_kho (
    ma_phieu_nhap           BIGINT IDENTITY(1,1) NOT NULL,
    so_phieu_nhap           VARCHAR(30)   NOT NULL UNIQUE,
    ma_ncc                  NVARCHAR(20)  NOT NULL,
    so_hoa_don_vat          VARCHAR(50)   NOT NULL,
    ngay_hoa_don            DATE          NOT NULL,
    file_chung_tu_url       NVARCHAR(255) NULL,
    ngay_gio_lap            DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    ma_nhan_vien_lap        INT           NOT NULL,
    ma_quan_ly_duyet        INT           NULL,
    kenh_phe_duyet          VARCHAR(20)   NULL,
    chk_bao_bi_nguyen_ven   BIT           NOT NULL DEFAULT 1, -- Checklist GPP [1]
    chk_nhan_lo_hsd_khop    BIT           NOT NULL DEFAULT 1, -- Checklist GPP [2]
    chk_nhiet_do_bao_quan   BIT           NOT NULL DEFAULT 1, -- Checklist GPP [3]
    ly_do_dac_cach          NVARCHAR(500) NULL,               -- Bắt buộc nếu có lô < 180 ngày
    tong_tien_nhap          DECIMAL(18,2) NOT NULL DEFAULT 0,
    trang_thai_nhap         VARCHAR(25)   NOT NULL DEFAULT 'NHAP_NHAP',
    CONSTRAINT pk_phieu_nhap PRIMARY KEY (ma_phieu_nhap),
    CONSTRAINT fk_nhap_ncc FOREIGN KEY (ma_ncc) 
        REFERENCES tbl_nha_cung_cap_gdp(ma_ncc),
    CONSTRAINT fk_nhap_nv_lap FOREIGN KEY (ma_nhan_vien_lap) 
        REFERENCES tbl_nguoi_dung(ma_nguoi_dung),
    CONSTRAINT fk_nhap_ql_duyet FOREIGN KEY (ma_quan_ly_duyet) 
        REFERENCES tbl_nguoi_dung(ma_nguoi_dung),
    CONSTRAINT ck_trang_thai_nhap CHECK (
        trang_thai_nhap IN ('NHAP_NHAP', 'CHO_KIEM_NHAP', 'CHO_DUYET_NHAP', 'CHO_DUYET_DAC_CACH', 'DA_DUYET_NHAP', 'DA_HUY')
    )
);
GO

-- =========================================================================================
-- 8. BẢNG CHI TIẾT PHIẾU NHẬP KHO (MÀN HÌNH 2 - UC-02)
-- =========================================================================================
CREATE TABLE tbl_ct_phieu_nhap (
    ma_ct_nhap              BIGINT IDENTITY(1,1) NOT NULL,
    ma_phieu_nhap           BIGINT        NOT NULL,
    ma_lo                   BIGINT        NOT NULL,
    ma_quy_doi              BIGINT        NOT NULL,
    so_luong_nhap           INT           NOT NULL,
    so_luong_co_ban         INT           NOT NULL, -- so_luong_nhap * ty_le_quy_doi
    don_gia_nhap            DECIMAL(18,2) NOT NULL,
    vat_phan_tram           TINYINT       NOT NULL DEFAULT 5,
    dat_cam_quan_gpp        BIT           NOT NULL DEFAULT 1,
    ghi_chu_han_gpp         NVARCHAR(255) NULL,
    CONSTRAINT pk_ct_phieu_nhap PRIMARY KEY (ma_ct_nhap),
    CONSTRAINT fk_ct_nhap_phieu FOREIGN KEY (ma_phieu_nhap) 
        REFERENCES tbl_phieu_nhap_kho(ma_phieu_nhap) ON DELETE CASCADE,
    CONSTRAINT fk_ct_nhap_lo FOREIGN KEY (ma_lo) 
        REFERENCES tbl_lo_thuoc(ma_lo),
    CONSTRAINT fk_ct_nhap_quy_doi FOREIGN KEY (ma_quy_doi) 
        REFERENCES tbl_quy_doi_don_vi(ma_quy_doi),
    CONSTRAINT ck_ct_sl_nhap CHECK (so_luong_nhap > 0)
);
GO

-- =========================================================================================
-- 9. BẢNG HÓA ĐƠN BÁN LẺ QUẦY POS (MÀN HÌNH 3 - UC-05)
-- [Đã fix]: Bổ sung đầy đủ thông tin Đơn thuốc kê đơn ETC (Bác sĩ, Cơ sở khám, Chẩn đoán)
-- =========================================================================================
CREATE TABLE tbl_hoa_don_ban_le (
    ma_hoa_don              BIGINT IDENTITY(1,1) NOT NULL,
    so_hoa_don              VARCHAR(30)   NULL,
    ma_nhan_vien            INT           NOT NULL,
    ngay_ban                DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    ten_khach_hang          NVARCHAR(100) NULL,
    ma_don_thuoc_etc        VARCHAR(50)   NULL,
    bac_si_ke_don           NVARCHAR(150) NULL, -- Bắt buộc nhập trên POS khi có thuốc ETC (R05)
    co_so_kham_benh         NVARCHAR(200) NULL,
    chan_doan_benh          NVARCHAR(300) NULL, -- Bắt buộc nhập trên POS khi có thuốc ETC (R05)
    tong_tien               DECIMAL(18,2) NOT NULL,
    tien_giam_gia           DECIMAL(18,2) NOT NULL DEFAULT 0,
    tong_thanh_toan         DECIMAL(18,2) NOT NULL,
    phuong_thuc_tt          VARCHAR(20)   NOT NULL,
    ma_viet_qr              NVARCHAR(500) NULL,
    trang_thai              VARCHAR(20)   NOT NULL DEFAULT 'HOAN_TAT',
    CONSTRAINT pk_hoa_don_ban_le PRIMARY KEY (ma_hoa_don),
    CONSTRAINT fk_hd_nhan_vien FOREIGN KEY (ma_nhan_vien) 
        REFERENCES tbl_nguoi_dung(ma_nguoi_dung),
    CONSTRAINT ck_phuong_thuc_tt CHECK (phuong_thuc_tt IN ('TIEN_MAT', 'VIETQR', 'THE')),
    CONSTRAINT ck_tong_tien CHECK (tong_tien >= 0)
);
GO

-- =========================================================================================
-- 10. BẢNG CHI TIẾT HÓA ĐƠN BÁN LẺ (MÀN HÌNH 3 - UC-05)
-- =========================================================================================
CREATE TABLE tbl_ct_hoa_don (
    ma_ct_hoa_don           BIGINT IDENTITY(1,1) NOT NULL,
    ma_hoa_don              BIGINT        NOT NULL,
    ma_lo                   BIGINT        NOT NULL, -- Tham chiếu lô xuất FEFO
    so_luong_ban            INT           NOT NULL,
    don_vi_ban              NVARCHAR(50)  NOT NULL,
    so_luong_co_ban         INT           NOT NULL, -- Sau quy đổi trừ tồn kho
    don_gia_ban             DECIMAL(18,2) NOT NULL,
    thanh_tien              DECIMAL(18,2) NOT NULL,
    CONSTRAINT pk_ct_hoa_don PRIMARY KEY (ma_ct_hoa_don),
    CONSTRAINT fk_ct_hd FOREIGN KEY (ma_hoa_don) 
        REFERENCES tbl_hoa_don_ban_le(ma_hoa_don) ON DELETE CASCADE,
    CONSTRAINT fk_ct_lo FOREIGN KEY (ma_lo) 
        REFERENCES tbl_lo_thuoc(ma_lo),
    CONSTRAINT ck_sl_ban CHECK (so_luong_ban > 0),
    CONSTRAINT ck_don_gia CHECK (don_gia_ban > 0)
);
GO

-- =========================================================================================
-- 11. BẢNG PHIẾU XUẤT KHO PHI THƯƠNG MẠI (XUẤT HỦY THUỐC HẾT HẠN / TRẢ NCC - MÀN 1 TAB 2)
-- =========================================================================================
CREATE TABLE tbl_phieu_xuat_kho (
    ma_phieu_xuat           BIGINT IDENTITY(1,1) NOT NULL,
    so_phieu_xuat           VARCHAR(30)   NOT NULL UNIQUE,
    loai_xuat               VARCHAR(30)   NOT NULL, -- 'XUAT_HUY_HET_HAN', 'XUAT_TRA_NCC'
    ngay_lap                DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    ma_nhan_vien_lap        INT           NOT NULL,
    ma_quan_ly_duyet        INT           NULL,
    ly_do_xuat              NVARCHAR(500) NOT NULL,
    trang_thai              VARCHAR(20)   NOT NULL DEFAULT 'DA_DUYET',
    CONSTRAINT pk_phieu_xuat PRIMARY KEY (ma_phieu_xuat),
    CONSTRAINT fk_xuat_nv_lap FOREIGN KEY (ma_nhan_vien_lap) REFERENCES tbl_nguoi_dung(ma_nguoi_dung),
    CONSTRAINT fk_xuat_ql_duyet FOREIGN KEY (ma_quan_ly_duyet) REFERENCES tbl_nguoi_dung(ma_nguoi_dung)
);
GO

-- =========================================================================================
-- 12. BẢNG CHI TIẾT PHIẾU XUẤT KHO
-- =========================================================================================
CREATE TABLE tbl_ct_phieu_xuat (
    ma_ct_xuat              BIGINT IDENTITY(1,1) NOT NULL,
    ma_phieu_xuat           BIGINT        NOT NULL,
    ma_lo                   BIGINT        NOT NULL,
    so_luong_xuat_co_ban    INT           NOT NULL,
    ghi_chu_kiem_soat       NVARCHAR(255) NULL,
    CONSTRAINT pk_ct_phieu_xuat PRIMARY KEY (ma_ct_xuat),
    CONSTRAINT fk_ct_xuat_phieu FOREIGN KEY (ma_phieu_xuat) 
        REFERENCES tbl_phieu_xuat_kho(ma_phieu_xuat) ON DELETE CASCADE,
    CONSTRAINT fk_ct_xuat_lo FOREIGN KEY (ma_lo) 
        REFERENCES tbl_lo_thuoc(ma_lo),
    CONSTRAINT ck_sl_xuat CHECK (so_luong_xuat_co_ban > 0)
);
GO

-- =========================================================================================
-- 13. BẢNG NHẬT KÝ KIỂM TOÁN HỆ THỐNG (AUDIT LOG)
-- =========================================================================================
CREATE TABLE tbl_nhat_ky_he_thong (
    ma_log                  BIGINT IDENTITY(1,1) NOT NULL,
    thoi_gian               DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    ma_nguoi_dung           INT           NULL,
    hanh_dong               VARCHAR(50)   NOT NULL,
    bang_tac_dong           VARCHAR(50)   NOT NULL,
    khoa_ban_ghi            VARCHAR(50)   NULL,
    du_lieu_cu_json         NVARCHAR(MAX) NULL,
    du_lieu_moi_json        NVARCHAR(MAX) NULL,
    CONSTRAINT pk_nhat_ky_he_thong PRIMARY KEY (ma_log)
);
GO

-- =========================================================================================
-- 14. CHỈ MỤC TỐI ƯU HÓA TRUY VẤN & TRIGGER CHẶN ÂM KHO BẤT BIẾN
-- =========================================================================================
CREATE INDEX idx_fefo ON tbl_lo_thuoc (ma_thuoc, han_dung ASC)
    INCLUDE (so_lo, so_luong_ton, trang_thai_lo);
GO

CREATE INDEX idx_barcode ON tbl_dm_thuoc (ma_vach_barcode);
GO

CREATE TRIGGER trg_check_ton_kho_am
ON tbl_lo_thuoc AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted WHERE so_luong_ton < 0)
    BEGIN
        RAISERROR(N'Lỗi nghiệp vụ (BR-INV-06): Số lượng tồn kho không thể mang giá trị âm!', 16, 1);
        ROLLBACK TRANSACTION;
    END
END;
GO

-- =========================================================================================
-- 15. VIEW HỖ TRỢ TRUY VẤN NHANH CHO 3 MÀN HÌNH (FEFO & MÃ MÀU CẢNH BÁO HẠN)
-- [Đã fix]: Bao gồm cả các lô cận hạn (CAN_HAN_30/60/90/180) vào diện ưu tiên xuất FEFO
-- =========================================================================================
CREATE VIEW vw_lo_thuoc_fefo AS
SELECT 
    l.ma_lo,
    ISNULL(l.ma_lo_hien_thi, 'LO-' + RIGHT('00' + CAST(l.ma_lo AS VARCHAR(10)), 2)) AS ma_lo_hien_thi,
    l.ma_thuoc,
    d.ten_thuoc,
    d.hoat_chat,
    d.phan_loai_ke_don,
    l.so_lo,
    l.ngay_san_xuat,
    l.han_dung,
    l.ngay_nhap_kho,
    l.so_luong_ton,
    l.don_vi_co_ban,
    l.gia_von_nhap,
    l.trang_thai_lo,
    l.so_ngay_con_lai,
    CASE 
        WHEN l.so_ngay_con_lai <= 0 OR l.trang_thai_lo = 'KHOA_HET_HAN' THEN 'LOCKED'
        WHEN l.so_ngay_con_lai <= 30 THEN 'RED'
        WHEN l.so_ngay_con_lai <= 90 THEN 'ORANGE'
        WHEN l.so_ngay_con_lai <= 180 THEN 'YELLOW'
        ELSE 'GREEN'
    END AS ma_mau_canh_bao,
    CASE 
        WHEN l.so_luong_ton > 0 
             AND l.so_ngay_con_lai > 0 
             AND l.trang_thai_lo IN ('KHA_DUNG', 'CAN_HAN_180', 'CAN_HAN_90', 'CAN_HAN_60', 'CAN_HAN_30')
        THEN 1 
        ELSE 0 
    END AS cho_phep_xuat_fefo
FROM tbl_lo_thuoc l
INNER JOIN tbl_dm_thuoc d ON l.ma_thuoc = d.ma_thuoc;
GO
