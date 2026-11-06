/* ============================================================================
   TỰ ĐỘNG KHỞI TẠO / CẬP NHẬT CƠ SỞ DỮ LIỆU (db-setup.js)
   Chức năng:
     - Khi chạy "npm start": nếu CSDL chưa có -> tự tạo bảng + nạp dữ liệu mẫu.
     - Nếu file database/01_schema_3nf_gpp.sql hoặc 02_seed_data_test.sql thay đổi
       (vd: sau khi git pull) -> tự tạo lại CSDL theo phiên bản mới.
     - Dấu vân tay (hash SHA-256) của 2 file SQL được lưu trong Extended Property
       "GPP_SCHEMA_HASH" của database, không thêm bảng mới vào lược đồ 3NF.
   Tắt tự động tạo lại: đặt DB_AUTO_REBUILD=false trong file .env
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sql, buildDbConfig, describeTarget, probeConnection, AUTH_MODE } = require('./db');

const DB_DIR = path.join(__dirname, '../../database');
const SQL_FILES = ['01_schema_3nf_gpp.sql', '02_seed_data_test.sql'];
const HASH_PROPERTY = 'GPP_SCHEMA_HASH';

function getDbName() {
  return process.env.DB_NAME || 'MinhTienPharmacyGPP';
}

/* Hàm readSqlFiles: Đọc nội dung 2 file SQL (bỏ BOM, chuẩn hóa xuống dòng để hash giống nhau trên mọi máy) */
function readSqlFiles() {
  return SQL_FILES.map(file => ({
    file,
    text: fs.readFileSync(path.join(DB_DIR, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  }));
}

/* Hàm computeSqlHash: Tính dấu vân tay phiên bản CSDL từ nội dung 2 file SQL */
function computeSqlHash() {
  const h = crypto.createHash('sha256');
  readSqlFiles().forEach(f => h.update(f.file + '\n' + f.text));
  return h.digest('hex').slice(0, 32);
}

/* Hàm splitBatches: Tách script SQL thành các batch theo dòng "GO" (giống SSMS/sqlcmd) */
function splitBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*;?\s*$/gim)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

/* Hàm connectMaster: Mở 1 kết nối duy nhất vào master (để lệnh USE có hiệu lực giữa các batch) */
async function connectMaster() {
  await probeConnection('master');
  const cfg = buildDbConfig('master');
  cfg.pool = { max: 1, min: 0, idleTimeoutMillis: 60000 };
  return new sql.ConnectionPool(cfg).connect();
}

/* Hàm getDatabaseState: Kiểm tra CSDL đã tồn tại chưa và đang ở phiên bản (hash) nào */
async function getDatabaseState(pool) {
  const dbName = getDbName();
  const exists = await pool.request().input('n', sql.NVarChar(128), dbName).query('SELECT DB_ID(@n) AS id');
  if (!exists.recordset[0].id) return { exists: false, hash: null };
  const prop = await pool.request().query(`
    SELECT CAST(value AS NVARCHAR(100)) AS v
    FROM [${dbName}].sys.extended_properties
    WHERE class = 0 AND name = N'${HASH_PROPERTY}';
  `);
  return { exists: true, hash: prop.recordset[0] ? prop.recordset[0].v : null };
}

/* Hàm runInitScripts: Chạy 2 file SQL tạo lại CSDL + dữ liệu mẫu, rồi ghi hash phiên bản */
async function runInitScripts(pool, hash) {
  for (const { file, text } of readSqlFiles()) {
    const batches = splitBatches(text);
    console.log(`[DB]   -> Chạy ${file} (${batches.length} batch) ...`);
    for (let i = 0; i < batches.length; i++) {
      try {
        await pool.request().batch(batches[i]);
      } catch (err) {
        console.error(`[DB] Lỗi tại ${file} - batch #${i + 1}:\n${batches[i].slice(0, 300)}...`);
        throw err;
      }
    }
  }
  const dbName = getDbName();
  await pool.request().batch(`
    USE [${dbName}];
    IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 0 AND name = N'${HASH_PROPERTY}')
      EXEC sys.sp_dropextendedproperty @name = N'${HASH_PROPERTY}';
    EXEC sys.sp_addextendedproperty @name = N'${HASH_PROPERTY}', @value = N'${hash}';
    USE master;
  `);
}

/* Hàm ensureDatabase: Gọi khi khởi động server - tự tạo / cập nhật CSDL nếu cần.
   force = true: luôn tạo lại (dùng cho lệnh npm run db:init) */
async function ensureDatabase({ force = false } = {}) {
  const autoRebuild = String(process.env.DB_AUTO_REBUILD || 'true').toLowerCase() !== 'false';
  console.log(`[DB] Kết nối SQL Server: ${describeTarget()}`);
  const pool = await connectMaster();
  try {
    const hash = computeSqlHash();
    const state = await getDatabaseState(pool);
    const dbName = getDbName();

    let reason = null;
    if (force) reason = 'chạy lệnh khởi tạo lại';
    else if (!state.exists) reason = `chưa có CSDL "${dbName}"`;
    else if (state.hash !== hash) {
      if (!autoRebuild) {
        console.warn(`[DB] CẢNH BÁO: File SQL đã thay đổi nhưng DB_AUTO_REBUILD=false -> giữ nguyên CSDL cũ. Chạy "npm run db:init" để cập nhật.`);
        return { rebuilt: false };
      }
      reason = state.hash ? 'file SQL trong dự án đã thay đổi' : 'CSDL chưa có thông tin phiên bản';
    }

    if (!reason) {
      console.log(`[DB] CSDL "${dbName}" đã đúng phiên bản mới nhất.`);
      return { rebuilt: false };
    }

    console.log(`[DB] Đang tạo lại CSDL "${dbName}" (lý do: ${reason}). Dữ liệu cũ sẽ được thay bằng dữ liệu mẫu ...`);
    await runInitScripts(pool, hash);
    console.log(`[DB] Đã tạo CSDL "${dbName}" và nạp dữ liệu mẫu thành công.`);
    return { rebuilt: true };
  } finally {
    await pool.close();
  }
}

/* Hàm explainError: In gợi ý cách sửa cho các lỗi kết nối hay gặp */
function explainError(err) {
  const code = err.code || (err.originalError && err.originalError.code) || '';
  const msg = String(err.message || (err.originalError && err.originalError.message) || err);
  console.error(`\n[DB] LỖI KẾT NỐI SQL SERVER: ${code} ${msg}\n`);
  if (AUTH_MODE === 'windows') {
    console.error('Gợi ý (Windows Authentication):');
    console.error('  1. Mở SSMS, copy y nguyên ô "Server name" vào DB_SERVER trong file .env');
    console.error('     (vd: localhost\\SQLEXPRESS, DESKTOP-ABC123\\SQLEXPRESS, hoặc localhost)');
    console.error('  2. Kiểm tra dịch vụ "SQL Server (...)" đang chạy: Win + R -> services.msc');
    console.error('  3. Nếu dùng Docker thì đặt DB_AUTH=sql (Docker không hỗ trợ Windows Authentication)');
  } else if (code === 'ELOGIN' || /Login failed/i.test(msg)) {
    console.error('Gợi ý: Sai DB_USER / DB_PASSWORD, hoặc SQL Server chưa bật chế độ đăng nhập bằng mật khẩu.');
  } else {
    console.error('Gợi ý: Kiểm tra SQL Server / container Docker đang chạy (docker start sql1) và DB_SERVER, DB_PORT trong .env.');
  }
}

/* Hàm printDatabaseSummary: In số dòng dữ liệu một số bảng chính */
async function printDatabaseSummary() {
  const pool = await connectMaster();
  try {
    const ver = await pool.request().query(`SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS v, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) AS e`);
    console.log(`[OK] Kết nối thành công: SQL Server ${ver.recordset[0].v} - ${ver.recordset[0].e}`);
    const dbName = getDbName();
    const state = await getDatabaseState(pool);
    if (!state.exists) {
      console.log(`[CHƯA CÓ] CSDL "${dbName}" chưa được tạo. Chạy "npm start" hoặc "npm run db:init" để tự tạo.`);
      return;
    }
    const counts = await pool.request().query(`
      SELECT 'tbl_nguoi_dung' AS bang, COUNT(*) AS so_dong FROM [${dbName}].dbo.tbl_nguoi_dung
      UNION ALL SELECT 'tbl_dm_thuoc', COUNT(*) FROM [${dbName}].dbo.tbl_dm_thuoc
      UNION ALL SELECT 'tbl_lo_thuoc', COUNT(*) FROM [${dbName}].dbo.tbl_lo_thuoc
      UNION ALL SELECT 'tbl_hoa_don_ban_le', COUNT(*) FROM [${dbName}].dbo.tbl_hoa_don_ban_le;
    `);
    const upToDate = state.hash === computeSqlHash();
    console.log(`[OK] CSDL "${dbName}" (${upToDate ? 'đúng phiên bản mới nhất' : 'KHÁC phiên bản file SQL -> sẽ tự cập nhật khi npm start'}):`);
    counts.recordset.forEach(r => console.log(`     - ${r.bang}: ${r.so_dong} dòng`));
  } finally {
    await pool.close();
  }
}

module.exports = {
  ensureDatabase,
  explainError,
  printDatabaseSummary,
  readSqlFiles,
  SQL_FILES,
  DB_DIR
};
