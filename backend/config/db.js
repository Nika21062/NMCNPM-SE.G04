/* ============================================================================
   CẤU HÌNH KẾT NỐI CƠ SỞ DỮ LIỆU MICROSOFT SQL SERVER (db.js)
   Chức năng: Thiết lập Connection Pool kết nối tới CSDL MinhTienPharmacyGPP.
   Hỗ trợ 2 kiểu đăng nhập (chọn bằng DB_AUTH trong file .env):
     - windows : Windows Authentication - kết nối trực tiếp như SSMS, KHÔNG cần mật khẩu
                 (dùng driver ODBC msnodesqlv8, chỉ chạy trên Windows)
     - sql     : SQL Server Authentication - tài khoản + mật khẩu (vd: sa, dùng cho Docker)
   File .env sẽ tự được tạo từ .env.example ở lần chạy đầu tiên.
   ============================================================================ */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '../..');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, '.env.example');

/* Tự tạo file .env từ .env.example nếu thành viên chưa tạo */
if (!fs.existsSync(ENV_FILE) && fs.existsSync(ENV_EXAMPLE_FILE)) {
  fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  console.log('[DB] Chưa có file .env -> đã tự tạo từ .env.example. Sửa DB_SERVER trong .env nếu không kết nối được.');
}
require('dotenv').config({ path: ENV_FILE });

const AUTH_MODE = String(process.env.DB_AUTH || 'windows').trim().toLowerCase() === 'sql' ? 'sql' : 'windows';

/* Nạp đúng thư viện theo kiểu đăng nhập (cả hai đều có chung API của mssql) */
let sql;
if (AUTH_MODE === 'windows') {
  try {
    sql = require('mssql/msnodesqlv8');
  } catch (e) {
    console.error('[DB] Không nạp được driver msnodesqlv8 cho Windows Authentication. Chạy lại: npm install');
    throw e;
  }
} else {
  sql = require('mssql');
}

/* Hàm đọc biến môi trường kiểu true/false */
function envBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/* Hàm detectOdbcDriver: Tìm ODBC driver SQL Server mới nhất đang cài trên máy Windows */
let cachedOdbcDriver = null;
function detectOdbcDriver() {
  if (process.env.DB_ODBC_DRIVER) return process.env.DB_ODBC_DRIVER.trim();
  if (cachedOdbcDriver) return cachedOdbcDriver;
  let installed = '';
  try {
    installed = execSync('reg query "HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    installed = '';
  }
  const preferred = ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'ODBC Driver 13 for SQL Server', 'SQL Server Native Client 11.0'];
  cachedOdbcDriver = preferred.find(d => installed.includes(d)) || 'SQL Server';
  return cachedOdbcDriver;
}

/* Tên máy chủ SQL Server: copy y nguyên ô "Server name" trong SSMS (vd: localhost\SQLEXPRESS, DESKTOP-ABC, .) */
function getServerName() {
  return (process.env.DB_SERVER || 'localhost').trim();
}

/* Hàm buildDbConfig: Tạo cấu hình kết nối, cho phép đổi tên database (dùng 'master' khi khởi tạo CSDL) */
function buildDbConfig(databaseOverride) {
  const database = databaseOverride || process.env.DB_NAME || 'MinhTienPharmacyGPP';
  const server = getServerName();
  const pool = { max: 10, min: 0, idleTimeoutMillis: 30000 };

  if (AUTH_MODE === 'windows') {
    const driver = detectOdbcDriver();
    /* Driver ODBC 18 mặc định bật mã hóa -> cần TrustServerCertificate cho máy cá nhân */
    const connectionString =
      `Driver={${driver}};Server=${server};Database=${database};` +
      'Trusted_Connection=Yes;TrustServerCertificate=Yes;';
    return {
      server,
      database,
      driver: 'msnodesqlv8',
      connectionString,
      options: { trustedConnection: true, trustServerCertificate: true },
      pool,
      connectionTimeout: 15000,
      requestTimeout: 30000
    };
  }

  /* SQL Server Authentication (tài khoản + mật khẩu) - dùng cho Docker hoặc server từ xa */
  let host = server;
  let instanceName = (process.env.DB_INSTANCE || '').trim();
  if (host.includes('\\')) {
    [host, instanceName] = host.split('\\');
  }
  if (host === '.' || host === '(local)') host = 'localhost';
  const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    server: host,
    database,
    options: {
      encrypt: envBool('DB_ENCRYPT', true),
      trustServerCertificate: true,
      enableArithAbort: true
    },
    pool,
    connectionTimeout: 15000,
    requestTimeout: 30000
  };
  if (instanceName) {
    config.options.instanceName = instanceName;
  } else {
    config.port = Number(process.env.DB_PORT || 1433);
  }
  return config;
}

/* Hàm describeTarget: Mô tả kết nối hiện tại để in ra màn hình */
function describeTarget() {
  if (AUTH_MODE === 'windows') {
    return `${getServerName()} (Windows Authentication, driver: ${detectOdbcDriver()})`;
  }
  const cfg = buildDbConfig();
  const host = cfg.options.instanceName ? `${cfg.server}\\${cfg.options.instanceName}` : `${cfg.server}:${cfg.port}`;
  return `${host} (SQL Authentication, user: ${cfg.user})`;
}

/* Hàm probeConnection: Với Windows Authentication, mở thử 1 kết nối ODBC trực tiếp để lấy đúng nội dung lỗi
   (thư viện mssql bọc lỗi của msnodesqlv8 thành "[object Object]" nên khó đọc) */
function probeConnection(databaseOverride) {
  if (AUTH_MODE !== 'windows') return Promise.resolve();
  const cfg = buildDbConfig(databaseOverride);
  const msnodesql = require('msnodesqlv8');
  return new Promise((resolve, reject) => {
    msnodesql.open({ conn_str: cfg.connectionString, conn_timeout: 15 }, (err, conn) => {
      if (err) {
        const details = Array.isArray(err.details) ? err.details.map(d => d.message) : [err.message];
        const e = new Error(details.filter(Boolean).join('\n    '));
        e.code = err.sqlState || 'ODBC';
        return reject(e);
      }
      conn.close(() => resolve());
    });
  });
}

/* Cấu hình thông số kết nối SQL Server chuẩn 3NF */
const dbConfig = buildDbConfig();

/* Biến lưu trữ đối tượng kết nối dùng chung (Singleton Pool) */
let poolPromise = null;

/* Hàm getPool: Khởi tạo hoặc trả về kết nối SQL Server đang hoạt động (tự kết nối lại nếu bị ngắt) */
async function getPool() {
  if (poolPromise) {
    try {
      const existingPool = await poolPromise;
      if (existingPool && existingPool.connected) {
        return existingPool;
      }
      poolPromise = null;
    } catch (e) {
      poolPromise = null;
    }
  }

  poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
      pool.on('error', () => {
        poolPromise = null;
      });
      return pool;
    })
    .catch(err => {
      poolPromise = null;
      throw err;
    });

  return poolPromise;
}

module.exports = {
  sql,
  getPool,
  dbConfig,
  buildDbConfig,
  describeTarget,
  probeConnection,
  AUTH_MODE
};
