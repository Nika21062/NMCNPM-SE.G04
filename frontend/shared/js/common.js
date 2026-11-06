/* ============================================================================
   THƯ VIỆN HÀM TIỆN ÍCH VÀ DỮ LIỆU DÙNG CHUNG (shared/js/common.js)
   Chức năng: Cung cấp hàm thông báo Toast, tính số ngày hạn dùng đồng bộ SQL Server,
   phân rã ĐVT, xác thực đăng nhập theo vai trò RBAC (tbl_vai_tro & tbl_nguoi_dung)
   và tự động đồng bộ dữ liệu thời gian thực khi CSDL thay đổi
   ============================================================================ */

/* Địa chỉ gốc kết nối tới máy chủ Backend Node.js + SQL Server */
const API_BASE = 'http://localhost:3000/api';

/* Khóa lưu trữ vai trò và thông tin người dùng hiện tại trong localStorage */
const STORAGE_KEYS = {
  ROLE: 'GPP_CURRENT_ROLE',
  USER: 'GPP_CURRENT_USER'
};

/* Xóa triệt để mọi dữ liệu đệm cũ trong trình duyệt để đảm bảo luôn hiển thị dữ liệu thật từ SQL Server */
try {
  localStorage.removeItem('GPP_SYNC_DRUGS_V2');
  localStorage.removeItem('GPP_SYNC_LOTS_V2');
  localStorage.removeItem('GPP_SYNC_SUPPLIERS_V2');
  localStorage.removeItem('GPP_POS_CART_V2');
} catch (e) {}

/* Biến toàn cục lưu danh sách vai trò và người dùng đang đăng nhập từ SQL Server */
let gppRolesList = [];
let gppCurrentUser = null;
let gppRoleChangeCallback = null;
let pendingTargetRoleId = null;

/* Hàm showToast: Hiển thị thông báo nổi ở góc trên bên phải màn hình */
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* Hàm diffDaysFromToday: Tính khoảng cách số ngày từ ngày hiện tại (đồng bộ GETDATE() của SQL Server) đến hạn sử dụng */
function diffDaysFromToday(dateStr) {
  if (!dateStr) return 0;
  const cleanDate = String(dateStr).slice(0, 10);
  const target = new Date(cleanDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/* Hàm getLotAlertInfo: Phân loại mã màu cảnh báo hạn dùng (Đỏ/Cam/Vàng/Xanh/Khóa xám) theo chuẩn GPP và trạng thái SQL Server */
function getLotAlertInfo(expDateStr, lotObj = null) {
  const days = (lotObj && typeof lotObj.daysLeft === 'number')
    ? Number(lotObj.daysLeft)
    : diffDaysFromToday(expDateStr);

  if (lotObj && (lotObj.status === 'XUAT_HUY' || lotObj.status === 'XUAT_TRA_NCC')) {
    return { code: 'LOCKED', label: 'Đã xuất khỏi kho', badge: 'badge-locked', days };
  }
  if (lotObj && lotObj.status === 'CHO_DUYET_NHAP') {
    return { code: 'YELLOW', label: 'Chờ duyệt nhập kho', badge: 'badge-yellow', days };
  }
  if (days <= 0 || (lotObj && lotObj.status === 'KHOA_HET_HAN')) {
    return { code: 'LOCKED', label: 'Đã khóa hết hạn', badge: 'badge-locked', days };
  } else if (days <= 30) {
    return { code: 'RED', label: 'Nguy cấp <= 30 ngày', badge: 'badge-red', days };
  } else if (days <= 90) {
    return { code: 'ORANGE', label: 'Cận hạn 31-90 ngày', badge: 'badge-orange', days };
  } else if (days <= 180) {
    return { code: 'YELLOW', label: 'Theo dõi 91-180 ngày', badge: 'badge-yellow', days };
  }
  return { code: 'GREEN', label: 'An toàn > 180 ngày', badge: 'badge-green', days };
}

/* Hàm formatDecomposedStock: Phân rã tổng số lượng cơ bản thành chuỗi trực quan [X] Hộp + [Y] Vỉ + [Z] Viên */
function formatDecomposedStock(drug, totalBaseQty) {
  if (!drug || !Array.isArray(drug.units)) return `${totalBaseQty}`;
  const sortedUnits = [...drug.units].sort((a, b) => b.rate - a.rate);
  let rem = Math.max(0, Number(totalBaseQty || 0));
  const parts = [];
  for (const u of sortedUnits) {
    if (u.rate > 1) {
      const count = Math.floor(rem / u.rate);
      if (count > 0) parts.push(`${count} ${u.unitName}`);
      rem = rem % u.rate;
    } else {
      if (rem > 0 || parts.length === 0) parts.push(`${rem} ${u.unitName}`);
    }
  }
  return parts.join(' + ');
}

/* Hàm getCurrentRole: Lấy mã vai trò tài khoản đang đăng nhập hiện tại (ACT-01 hoặc ACT-02) */
function getCurrentRole() {
  if (gppCurrentUser && gppCurrentUser.roleId) return gppCurrentUser.roleId;
  return localStorage.getItem(STORAGE_KEYS.ROLE) || 'ACT-02';
}

/* Hàm getCurrentUser: Lấy toàn bộ đối tượng người dùng & quyền RBAC đang đăng nhập */
function getCurrentUser() {
  if (gppCurrentUser) return gppCurrentUser;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    if (raw) {
      gppCurrentUser = JSON.parse(raw);
      return gppCurrentUser;
    }
  } catch (e) {}
  const fallbackRole = getCurrentRole();
  return {
    userId: fallbackRole === 'ACT-01' ? 1 : 2,
    username: fallbackRole === 'ACT-01' ? 'chunhathuoc' : 'duocsi01',
    fullName: fallbackRole === 'ACT-01' ? 'DSĐH. Nguyễn Minh Tiến' : 'DSTH. Trần Thị Mai',
    roleId: fallbackRole,
    roleName: fallbackRole === 'ACT-01' ? 'Chủ nhà thuốc / Quản lý điều hành' : 'Dược sĩ bán lẻ tại quầy',
    canEditPrice: fallbackRole === 'ACT-01',
    canApproveStock: fallbackRole === 'ACT-01',
    canViewRevenue: fallbackRole === 'ACT-01'
  };
}

/* Hàm setCurrentUserSession: Lưu thông tin người dùng đã xác thực từ SQL Server vào bộ nhớ trình duyệt */
function setCurrentUserSession(userObj) {
  if (!userObj) return;
  gppCurrentUser = userObj;
  localStorage.setItem(STORAGE_KEYS.ROLE, userObj.roleId);
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userObj));
}

/* Hàm ensureRbacLoginModal: Khởi tạo hộp thoại Modal nhập Tên đăng nhập & Mật khẩu khi đổi vai trò */
function ensureRbacLoginModal() {
  if (document.getElementById('rbacLoginModal')) return;
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'modal-backdrop';
  modalBackdrop.id = 'rbacLoginModal';
  modalBackdrop.innerHTML = `
    <div class="modal" style="max-width: 440px;">
      <div class="modal-header">
        <h3>🔐 Xác thực Tài khoản theo Vai trò</h3>
        <button type="button" class="btn btn-outline" onclick="cancelRbacLoginModal()">Đóng [X]</button>
      </div>
      <div style="background:#eff6ff; border:1px solid #93c5fd; border-radius:8px; padding:10px 12px; margin-bottom:14px; font-size:12.5px; color:#1e3a8a;">
        Vai trò yêu cầu xác thực:<br/>
        <strong id="rbacTargetRoleLabel" style="font-size:13.5px; color:var(--primary-dark);"></strong>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label for="rbacLoginUsername">Tên đăng nhập (*)</label>
        <input type="text" id="rbacLoginUsername" placeholder="Nhập tên đăng nhập..." autocomplete="off" onkeydown="if(event.key==='Enter') document.getElementById('rbacLoginPassword').focus()" />
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label for="rbacLoginPassword">Mật khẩu (*)</label>
        <input type="password" id="rbacLoginPassword" placeholder="Nhập mật khẩu..." autocomplete="off" onkeydown="if(event.key==='Enter') submitRbacLoginModal()" />
      </div>
      <div id="rbacLoginError" style="display:none; color:var(--danger); background:#fef2f2; border:1px solid #fca5a5; padding:8px 10px; border-radius:6px; font-size:12px; font-weight:600; margin-bottom:12px;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:6px;">
        <button type="button" class="btn btn-outline" onclick="cancelRbacLoginModal()">Hủy bỏ</button>
        <button type="button" class="btn btn-primary" id="btnSubmitRbacLogin" onclick="submitRbacLoginModal()">Xác nhận Đăng nhập</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);
}

/* Hàm openRbacLoginModal: Mở hộp thoại yêu cầu nhập tài khoản và mật khẩu cho vai trò được chọn */
function openRbacLoginModal(targetRoleId) {
  ensureRbacLoginModal();
  pendingTargetRoleId = targetRoleId || getCurrentRole();
  const roleObj = gppRolesList.find(r => r.roleId === pendingTargetRoleId);
  const roleTitle = roleObj
    ? `${roleObj.roleName}`
    : (pendingTargetRoleId === 'ACT-01' ? 'Chủ nhà thuốc / Quản lý' : 'Dược sĩ bán lẻ tại quầy');

  const lbl = document.getElementById('rbacTargetRoleLabel');
  if (lbl) lbl.textContent = roleTitle;

  const errEl = document.getElementById('rbacLoginError');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  const userInp = document.getElementById('rbacLoginUsername');
  const passInp = document.getElementById('rbacLoginPassword');
  if (userInp) userInp.value = '';
  if (passInp) passInp.value = '';

  const modal = document.getElementById('rbacLoginModal');
  if (modal) modal.classList.add('open');
  setTimeout(() => userInp?.focus(), 60);
}

/* Hàm cancelRbacLoginModal: Đóng hộp thoại đăng nhập và trả dropdown về vai trò cũ */
function cancelRbacLoginModal() {
  const modal = document.getElementById('rbacLoginModal');
  if (modal) modal.classList.remove('open');
  const roleSelect = document.getElementById('currentRole');
  if (roleSelect) {
    roleSelect.value = getCurrentRole();
  }
  pendingTargetRoleId = null;
}

/* Hàm submitRbacLoginModal: Gửi thông tin tên đăng nhập và mật khẩu lên API SQL Server để kiểm tra */
async function submitRbacLoginModal() {
  const username = (document.getElementById('rbacLoginUsername')?.value || '').trim();
  const password = (document.getElementById('rbacLoginPassword')?.value || '').trim();
  const errEl = document.getElementById('rbacLoginError');

  if (!username || !password) {
    if (errEl) {
      errEl.textContent = 'Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!';
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleId: pendingTargetRoleId,
        username,
        password
      })
    });
    const data = await res.json();
    if (!data.ok || !data.user) {
      if (errEl) {
        errEl.textContent = data.message || 'Tên đăng nhập hoặc mật khẩu không đúng!';
        errEl.style.display = 'block';
      }
      showToast(data.message || 'Đăng nhập thất bại!', 'error');
      return;
    }

    setCurrentUserSession(data.user);
    const modal = document.getElementById('rbacLoginModal');
    if (modal) modal.classList.remove('open');
    pendingTargetRoleId = null;

    applyUserToRoleUI(data.user, true);
    showToast(data.message, 'success');
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Không kết nối được tới máy chủ SQL Server để xác thực!';
      errEl.style.display = 'block';
    }
  }
}

/* Hàm applyUserToRoleUI: Cập nhật thanh Header, Sidebar và gọi callback phân quyền trên màn hình */
function applyUserToRoleUI(userObj, notifyCallback = true) {
  if (!userObj) return;
  const roleSelect = document.getElementById('currentRole');
  const badge = document.getElementById('roleBadge');

  if (roleSelect && gppRolesList.length > 0) {
    roleSelect.innerHTML = gppRolesList
      .map(r => `<option value="${r.roleId}" ${r.roleId === userObj.roleId ? 'selected' : ''}>${r.roleName}</option>`)
      .join('');
    roleSelect.value = userObj.roleId;
  }

  if (badge) {
    badge.textContent = `Đang đăng nhập: ${userObj.fullName}`;
  }

  const oldInfoBox = document.getElementById('rbacCurrentUserInfo');
  if (oldInfoBox) {
    oldInfoBox.remove();
  }

  if (notifyCallback && typeof gppRoleChangeCallback === 'function') {
    gppRoleChangeCallback(userObj.roleId, userObj);
  }
}

/* Hàm syncAuthRolesFromDb: Đồng bộ danh sách vai trò (tbl_vai_tro) và thông tin người dùng (tbl_nguoi_dung) từ SQL Server */
async function syncAuthRolesFromDb() {
  const savedUser = getCurrentUser();
  try {
    const res = await fetch(`${API_BASE}/auth/roles?userId=${encodeURIComponent(savedUser.userId || '')}&roleId=${encodeURIComponent(savedUser.roleId || '')}&_t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) {
      gppRolesList = Array.isArray(data.roles) ? data.roles : [];
      if (data.currentUser) {
        setCurrentUserSession(data.currentUser);
      }
    }
  } catch (e) {}
  applyUserToRoleUI(getCurrentUser(), true);
}

/* Hàm initCommonRoleSwitcher: Khởi tạo bộ chuyển đổi vai trò RBAC ở góc dưới bên trái Sidebar */
function initCommonRoleSwitcher(onRoleChangeCallback) {
  gppRoleChangeCallback = onRoleChangeCallback;
  ensureRbacLoginModal();

  const roleSelect = document.getElementById('currentRole');
  if (roleSelect) {
    roleSelect.addEventListener('change', () => {
      const targetRole = roleSelect.value;
      /* Trả hiển thị select về vai trò hiện tại cho tới khi nhập đúng tài khoản & mật khẩu */
      roleSelect.value = getCurrentRole();
      openRbacLoginModal(targetRole);
    });
  }

  syncAuthRolesFromDb();
}

/* Hàm registerAutoDbSync: Tự động đồng bộ lại dữ liệu từ SQL Server khi người dùng quay lại cửa sổ trình duyệt */
function registerAutoDbSync(reloadScreenDataFn) {
  window.addEventListener('focus', () => {
    syncAuthRolesFromDb();
    if (typeof reloadScreenDataFn === 'function') {
      reloadScreenDataFn(true);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncAuthRolesFromDb();
      if (typeof reloadScreenDataFn === 'function') {
        reloadScreenDataFn(true);
      }
    }
  });
}
