/* ============================================================================
   CÔNG CỤ CƠ SỞ DỮ LIỆU CHO THÀNH VIÊN NHÓM (scripts/db-tools.js)
   Cách dùng:
     npm run db:check   -> Kiểm tra kết nối SQL Server + tình trạng CSDL
     npm run db:init    -> Ép tạo lại CSDL MinhTienPharmacyGPP + dữ liệu mẫu (XÓA dữ liệu cũ!)
     npm run db:bundle  -> Gộp 2 file SQL thành 1 file để mở bằng SSMS (database/00_full_setup_ssms.sql)
   Lưu ý: "npm start" đã TỰ ĐỘNG tạo / cập nhật CSDL, thường không cần chạy db:init.
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const { ensureDatabase, explainError, printDatabaseSummary, readSqlFiles, DB_DIR } = require('../backend/config/db-setup');

const BUNDLE_FILE = '00_full_setup_ssms.sql';

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
  for (const { file, text } of readSqlFiles()) {
    parts.push(`-- >>>>>>>>>>>>>>>>>>>> BẮT ĐẦU ${file} <<<<<<<<<<<<<<<<<<<<`);
    parts.push(text.trimEnd());
    parts.push('GO', '');
  }
  const out = path.join(DB_DIR, BUNDLE_FILE);
  fs.writeFileSync(out, '\uFEFF' + parts.join('\n').replace(/\n/g, '\r\n'), 'utf8');
  console.log(`[OK] Đã tạo database/${BUNDLE_FILE}`);
}

/* Điểm vào chương trình */
(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'check') await printDatabaseSummary();
    else if (cmd === 'init') {
      await ensureDatabase({ force: true });
      await printDatabaseSummary();
    } else if (cmd === 'bundle') bundleSql();
    else {
      console.log('Cách dùng: node scripts/db-tools.js <check|init|bundle>');
      process.exitCode = 1;
    }
  } catch (err) {
    explainError(err);
    process.exitCode = 1;
  }
})();
