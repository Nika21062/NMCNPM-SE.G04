/* ============================================================================
   CÔNG CỤ CƠ SỞ DỮ LIỆU CHO THÀNH VIÊN NHÓM (scripts/db-tools.js)
   Cách dùng:
     npm run db:check   -> Kiểm tra kết nối SQL Server + tình trạng CSDL
     npm run db:init    -> Tạo lại CSDL MinhTienPharmacyGPP + nạp dữ liệu mẫu (XÓA dữ liệu cũ!)
     npm run db:bundle  -> Gộp 2 file SQL thành 1 file để mở bằng SSMS (database/00_full_setup_ssms.sql)
   Không cần cài sqlcmd: script tự tách lệnh theo "GO" và chạy qua thư viện mssql.
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const { sql, buildDbConfig } = require('../backend/config/db');

const DB_DIR = path.join(__dirname, '../database');
const SQL_FILES = ['01_schema_3nf_gpp.sql', '02_seed_data_test.sql'];
const BUNDLE_FILE = '00_full_setup_ssms.sql';

/* Hàm describeTarget: Mô tả máy chủ đang kết nối để in ra màn hình */
function describeTarget(cfg) {
  const host = cfg.options.instanceName ? `${cfg.server}\\${cfg.options.instanceName}` : `${cfg.server}:${cfg.port}`;
  return `${host} (user: ${cfg.user})`;
}

/* Hàm explainError: Gợi ý cách sửa cho các lỗi kết nối hay gặp */
function explainError(err) {
  const code = err.code || (err.originalError && err.originalError.code) || '';
  const msg = String(err.message || '');
  console.error(`\n[LỖI] ${code} ${msg}\n`);
  if (code === 'ELOGIN' || /Login failed/i.test(msg)) {
    console.error('Gợi ý: Sai DB_USER / DB_PASSWORD, hoặc SQL Server chưa bật "SQL Server and Windows Authentication mode".');
    console.error('       Xem mục "Cấu hình SQL Server (SSMS)" trong README.md.');
  } else if (code === 'ESOCKET' || code === 'ETIMEOUT' || /ECONNREFUSED|Failed to connect/i.test(msg)) {
    console.error('Gợi ý: Không kết nối được tới máy chủ.');
    console.error('  - Docker: kiểm tra container đang chạy (docker ps) và đã map cổng 1433.');
    console.error('  - SQL Server cài trên Windows: bật TCP/IP trong "SQL Server Configuration Manager" rồi Restart dịch vụ.');
    console.error('  - Bản Express: đặt DB_INSTANCE=SQLEXPRESS và bật dịch vụ "SQL Server Browser", hoặc cố định cổng 1433.');
  } else if (code === 'EINSTLOOKUP') {
    console.error('Gợi ý: Không tìm thấy instance. Bật dịch vụ "SQL Server Browser" hoặc để trống DB_INSTANCE và dùng DB_PORT.');
  }
}

/* Hàm splitBatches: Tách script SQL thành các batch theo dòng "GO" (giống SSMS/sqlcmd) */
function splitBatches(sqlText) {
  return sqlText
    .replace(/^\uFEFF/, '')
    .split(/^\s*GO\s*;?\s*$/gim)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

/* Lệnh check: Kết nối vào master, in phiên bản SQL Server và kiểm tra CSDL dự án */
async function checkConnection() {
  const cfg = buildDbConfig('master');
  console.log(`Đang kết nối tới SQL Server ${describeTarget(cfg)} ...`);
  const pool = await new sql.ConnectionPool(cfg).connect();
  try {
    const ver = await pool.request().query(`SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS v, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) AS e`);
    console.log(`[OK] Kết nối thành công: SQL Server ${ver.recordset[0].v} - ${ver.recordset[0].e}`);

    const dbName = process.env.DB_NAME || 'MinhTienPharmacyGPP';
    const dbRes = await pool.request().input('n', sql.NVarChar(128), dbName).query('SELECT DB_ID(@n) AS id');
    if (!dbRes.recordset[0].id) {
      console.log(`[CHƯA CÓ] CSDL "${dbName}" chưa được tạo. Chạy: npm run db:init`);
      return;
    }

    const counts = await pool.request().query(`
      SELECT 'tbl_nguoi_dung' AS bang, COUNT(*) AS so_dong FROM [${dbName}].dbo.tbl_nguoi_dung
      UNION ALL SELECT 'tbl_dm_thuoc', COUNT(*) FROM [${dbName}].dbo.tbl_dm_thuoc
      UNION ALL SELECT 'tbl_lo_thuoc', COUNT(*) FROM [${dbName}].dbo.tbl_lo_thuoc
      UNION ALL SELECT 'tbl_hoa_don_ban_le', COUNT(*) FROM [${dbName}].dbo.tbl_hoa_don_ban_le;
    `);
    console.log(`[OK] CSDL "${dbName}" đã sẵn sàng:`);
    counts.recordset.forEach(r => console.log(`     - ${r.bang}: ${r.so_dong} dòng`));
  } finally {
    await pool.close();
  }
}

/* Lệnh init: Chạy lần lượt 2 file SQL trên CÙNG một kết nối (để lệnh USE có hiệu lực giữa các batch) */
async function initDatabase() {
  const cfg = buildDbConfig('master');
  cfg.pool = { max: 1, min: 1, idleTimeoutMillis: 60000 };
  console.log(`Đang kết nối tới SQL Server ${describeTarget(cfg)} ...`);
  const pool = await new sql.ConnectionPool(cfg).connect();
  try {
    for (const file of SQL_FILES) {
      const text = fs.readFileSync(path.join(DB_DIR, file), 'utf8');
      const batches = splitBatches(text);
      console.log(`-> Chạy ${file} (${batches.length} batch) ...`);
      for (let i = 0; i < batches.length; i++) {
        try {
          await pool.request().batch(batches[i]);
        } catch (err) {
          console.error(`\n[LỖI] ${file} - batch #${i + 1}:\n${batches[i].slice(0, 300)}...\n`);
          throw err;
        }
      }
    }
    console.log('[OK] Đã tạo CSDL MinhTienPharmacyGPP và nạp dữ liệu mẫu thành công.');
  } finally {
    await pool.close();
  }
  await checkConnection();
}

/* Lệnh bundle: Gộp 2 file SQL thành 1 file UTF-8 có BOM để SSMS đọc đúng tiếng Việt */
function bundleSql() {
  const parts = [
    '/* =========================================================================================',
    '   FILE GỘP TỰ ĐỘNG - DÙNG CHO SQL SERVER MANAGEMENT STUDIO (SSMS)',
    '   Mở file này trong SSMS rồi bấm Execute (F5) để tạo CSDL + dữ liệu mẫu.',
    '   KHÔNG sửa trực tiếp file này. Sửa 01_schema_3nf_gpp.sql / 02_seed_data_test.sql',
    '   rồi chạy: npm run db:bundle',
    '   ========================================================================================= */',
    ''
  ];
  for (const file of SQL_FILES) {
    const text = fs.readFileSync(path.join(DB_DIR, file), 'utf8').replace(/^\uFEFF/, '');
    parts.push(`-- >>>>>>>>>>>>>>>>>>>> BẮT ĐẦU ${file} <<<<<<<<<<<<<<<<<<<<`);
    parts.push(text.trimEnd());
    parts.push('GO', '');
  }
  const out = path.join(DB_DIR, BUNDLE_FILE);
  fs.writeFileSync(out, '\uFEFF' + parts.join('\r\n').replace(/\r?\n/g, '\r\n'), 'utf8');
  console.log(`[OK] Đã tạo ${path.relative(process.cwd(), out)}`);
}

/* Điểm vào chương trình */
(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'check') await checkConnection();
    else if (cmd === 'init') await initDatabase();
    else if (cmd === 'bundle') bundleSql();
    else {
      console.log('Cách dùng: node scripts/db-tools.js <check|init|bundle>');
      process.exitCode = 1;
    }
  } catch (err) {
    explainError(err);
    process.exitCode = 1;
  }
})();
