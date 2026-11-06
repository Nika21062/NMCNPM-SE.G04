/* ============================================================================
   CẤU HÌNH KẾT NỐI CƠ SỞ DỮ LIỆU MICROSOFT SQL SERVER (db.js)
   Chức năng: Thiết lập Connection Pool kết nối tới CSDL MinhTienPharmacyGPP
   và tự động kết nối lại nếu dịch vụ SQL Server / Docker khởi động lại.
   Thông số kết nối đọc từ file .env (xem .env.example) để mỗi thành viên
   dùng được cả SQL Server Docker lẫn SQL Server cài trên Windows (SSMS).
   ============================================================================ */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const sql = require('mssql');

/* Hàm đọc biến môi trường kiểu true/false */
function envBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/* Hàm buildDbConfig: Tạo cấu hình kết nối, cho phép đổi tên database (dùng 'master' khi khởi tạo CSDL) */
function buildDbConfig(databaseOverride) {
  const instanceName = (process.env.DB_INSTANCE || '').trim();
  const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'Sqlserver123@',
    server: process.env.DB_SERVER || 'localhost',
    database: databaseOverride || process.env.DB_NAME || 'MinhTienPharmacyGPP',
    options: {
      encrypt: envBool('DB_ENCRYPT', true),
      trustServerCertificate: envBool('DB_TRUST_CERT', true),
      enableArithAbort: true
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    },
    connectionTimeout: 15000,
    requestTimeout: 30000
  };

  /* Named instance (vd: SQLEXPRESS) dùng instanceName qua dịch vụ SQL Server Browser; ngược lại dùng cổng TCP */
  if (instanceName) {
    config.options.instanceName = instanceName;
  } else {
    config.port = Number(process.env.DB_PORT || 1433);
  }
  return config;
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
  buildDbConfig
};
