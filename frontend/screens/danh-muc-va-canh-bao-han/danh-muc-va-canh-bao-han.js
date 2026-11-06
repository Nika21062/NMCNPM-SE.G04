/* ============================================================================
   LOGIC NGHIỆP VỤ MÀN HÌNH 3: DANH MỤC THUỐC GPP & CẢNH BÁO LÔ/HẠN
   File: danh-muc-va-canh-bao-han.js
   Chức năng:
   1. Tải danh sách Thuốc, Ma trận Quy đổi ĐVT và Danh sách Lô từ SQL Server
   2. Chuyển đổi qua lại giữa 2 Tab (UC-01: Danh mục & ĐVT | UC-03: Lô & Cận hạn)
   3. Tìm kiếm thuốc theo tên/hoạt chất/barcode và thêm thuốc mới + khóa giá POS
   4. Lọc lô thuốc theo 5 mức màu hạn dùng, tìm kiếm lô và lập phiếu Xuất hủy / Trả NCC
   ============================================================================ */

/* Khởi tạo biến lưu danh sách thuốc, danh sách lô thuốc (Lấy 100% trực tiếp từ SQL Server), bộ lọc màu cảnh báo và tập hợp các lô được chọn xuất hủy/trả */
let drugs = [];
let lots = [];
let currentLotFilter = 'ALL';
const selectedDestroyLotIds = new Set();

/* Hàm isLotDestroyable: Kiểm tra lô có đủ điều kiện xuất hủy / trả NCC (quá hạn hoặc <= 30 ngày và còn tồn kho > 0) */
function isLotDestroyable(lot) {
  if (!lot) return false;
  const remDays = typeof lot.daysLeft === 'number' ? lot.daysLeft : diffDaysFromToday(lot.exp);
  return (
    remDays <= 30 &&
    Number(lot.baseQty) > 0 &&
    lot.status !== 'CHO_DUYET_NHAP' &&
    lot.status !== 'XUAT_HUY' &&
    lot.status !== 'XUAT_TRA_NCC'
  );
}

/* Hàm loadScreen1Data: Tải trực tiếp dữ liệu danh mục thuốc, ĐVT và lô thuốc từ API SQL Server */
async function loadScreen1Data(silent = false) {
  try {
    const res = await fetch(`${API_BASE}/danh-muc-va-canh-bao-han/data?_t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) {
      drugs = Array.isArray(data.drugs) ? data.drugs : [];
      lots = Array.isArray(data.lots) ? data.lots : [];
    } else if (!silent) {
      showToast('Lỗi truy vấn SQL Server: ' + (data.message || 'Không xác định'), 'error');
    }
  } catch (err) {
    if (!silent) {
      showToast('Không kết nối được tới máy chủ Backend SQL Server (http://localhost:3000)! Vui lòng bật server.', 'error');
    }
  }
  renderDrugTable();
  renderLotTable();
}

/* Hàm switchTab: Chuyển đổi hiển thị giữa Tab 1 (Danh mục & ĐVT) và Tab 2 (Tồn kho Lô & Cận hạn) */
function switchTab(tabId, btnEl) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
}

/* Hàm renderDrugTable: Hiển thị bảng Danh mục thuốc GPP, ma trận quy đổi 3 cấp ĐVT và tổng tồn khả dụng */
function renderDrugTable() {
  const keyword = (document.getElementById('searchDrugInput')?.value || '').trim().toLowerCase();
  const tbody = document.getElementById('drugTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  drugs
    .filter(d =>
      d.name.toLowerCase().includes(keyword) ||
      d.ingredient.toLowerCase().includes(keyword) ||
      d.barcode.toLowerCase().includes(keyword) ||
      d.id.toLowerCase().includes(keyword)
    )
    .forEach(d => {
      /* Tính tổng số lượng tồn khả dụng (chỉ cộng các lô còn hạn sử dụng > 0 ngày và khả dụng) */
      const availBase = lots
        .filter(l => {
          const remDays = typeof l.daysLeft === 'number' ? l.daysLeft : diffDaysFromToday(l.exp);
          return (
            l.drugId === d.id &&
            remDays > 0 &&
            l.status !== 'KHOA_HET_HAN' &&
            l.status !== 'XUAT_HUY' &&
            l.status !== 'XUAT_TRA_NCC' &&
            l.status !== 'CHO_DUYET_NHAP'
          );
        })
        .reduce((sum, l) => sum + l.baseQty, 0);

      const unitMatrixHtml = d.units
        .map(u => `
          <div>
            • 1 <strong>${u.unitName}</strong> = ${u.rate} ${d.baseUnit}
            &rarr; Giá niêm yết: <strong>${u.price.toLocaleString('vi-VN')}đ</strong>
            ${u.isDefaultSale ? `<span class="badge badge-otc" style="font-size:10px; margin-left:4px;">ĐVT Bán mặc định</span>` : ''}
          </div>
        `)
        .join('');

      const minStockVal = Number(d.minStock || 0);
      const isLowStock = availBase < minStockVal;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${d.id}</strong><br/>
          <small style="color:var(--muted)">Barcode: ${d.barcode}</small>
        </td>
        <td>
          <strong>${d.name}</strong><br/>
          <small style="color:var(--muted)">${d.ingredient}</small><br/>
          <small style="color:var(--primary-dark); font-size:11px;">📍 ${d.shelfLocation || 'Tủ A - Quầy bán lẻ'}</small>
        </td>
        <td>
          ${d.sdk}<br/>
          <span class="badge ${d.type === 'ETC' ? 'badge-etc' : 'badge-otc'}">${d.type === 'ETC' ? 'ETC - Thuốc kê đơn' : 'OTC - Không kê đơn'}</span>
        </td>
        <td>
          <strong>${d.baseUnit}</strong><br/>
          <small style="color:var(--muted);">Tồn tối thiểu: ${minStockVal} ${d.baseUnit}</small>
        </td>
        <td>${unitMatrixHtml}</td>
        <td>
          <strong>${availBase.toLocaleString('vi-VN')} ${d.baseUnit}</strong><br/>
          <small style="color:var(--primary-dark)">${formatDecomposedStock(d, availBase)}</small>
          ${isLowStock ? `<div style="margin-top:4px;"><span class="badge badge-red">⚠️ Dưới định mức tồn (${availBase}/${minStockVal})</span></div>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
}

/* Hàm openDrugModal: Mở hộp thoại thêm mới hồ sơ thuốc GPP và cấu hình 3 cấp ĐVT (theo quyền cho_phep_sua_gia trong DB) */
function openDrugModal() {
  const user = getCurrentUser();
  if (!user.canEditPrice) {
    showToast(`Phân quyền: Tài khoản "${user.fullName}" không có quyền thêm thuốc mới và khóa giá bán niêm yết!`, 'error');
    return;
  }
  const fieldsToClear = [
    'mdlBarcode', 'mdlName', 'mdlIngredient', 'mdlSdk', 'mdlType', 'mdlMinStock',
    'mdlStrength', 'mdlDosageForm', 'mdlShelfLocation',
    'u1Name', 'u1Price', 'u2Name', 'u2Rate', 'u2Price', 'u3Name', 'u3Rate', 'u3Price'
  ];
  fieldsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('drugModal').classList.add('open');
}

/* Hàm closeDrugModal: Đóng hộp thoại thêm mới hồ sơ thuốc */
function closeDrugModal() {
  document.getElementById('drugModal').classList.remove('open');
}

/* Hàm saveNewDrug: Kiểm tra dữ liệu, lưu hồ sơ thuốc mới + ma trận 3 cấp ĐVT vào SQL Server và cập nhật bảng */
async function saveNewDrug() {
  const barcode = document.getElementById('mdlBarcode').value.trim();
  const name = document.getElementById('mdlName').value.trim();
  const ingredient = document.getElementById('mdlIngredient').value.trim();
  const sdk = document.getElementById('mdlSdk').value.trim();
  const type = document.getElementById('mdlType').value;
  const minStock = Number(document.getElementById('mdlMinStock').value || 50);
  const strength = (document.getElementById('mdlStrength')?.value || '').trim();
  const dosageForm = (document.getElementById('mdlDosageForm')?.value || '').trim();
  const shelfLocation = (document.getElementById('mdlShelfLocation')?.value || '').trim();

  const u1Name = document.getElementById('u1Name').value.trim();
  const u1Price = Number(document.getElementById('u1Price').value);
  const u2Name = document.getElementById('u2Name').value.trim();
  const u2Rate = Number(document.getElementById('u2Rate').value);
  const u2Price = Number(document.getElementById('u2Price').value);
  const u3Name = document.getElementById('u3Name').value.trim();
  const u3Rate = Number(document.getElementById('u3Rate').value);
  const u3Price = Number(document.getElementById('u3Price').value);
  const user = getCurrentUser();

  if (!barcode || !name || !ingredient || !sdk || !type) {
    showToast('Vui lòng nhập đủ Mã vạch, Tên biệt dược, Hoạt chất, Số đăng ký và Chọn phân loại thuốc!', 'error');
    return;
  }
  if (!u1Name || !u2Name || !u3Name) {
    showToast('Vui lòng nhập đầy đủ Tên đơn vị tính cho cả 3 cấp (Cơ bản, Trung gian, Nhập kho)!', 'error');
    return;
  }
  if (drugs.some(d => d.barcode === barcode || d.sdk === sdk)) {
    showToast('ERR_DUPLICATE_DRUG: Mã vạch Barcode hoặc Số đăng ký (SĐK) đã tồn tại trong CSDL!', 'error');
    return;
  }
  if (u2Rate <= 1 || u3Rate <= u2Rate || u1Price <= 0 || u2Price <= 0 || u3Price <= 0) {
    showToast('ERR_INVALID_UNIT_RATE: Hệ số quy đổi phải tăng dần (1 < Trung gian < Nhập kho) và giá bán các cấp > 0!', 'error');
    return;
  }
  const lowerNames = [u1Name.toLowerCase(), u2Name.toLowerCase(), u3Name.toLowerCase()];
  if (new Set(lowerNames).size !== lowerNames.length) {
    showToast('ERR_DUPLICATE_UNIT_NAME: Tên của 3 cấp đơn vị tính (Cơ bản, Trung gian, Nhập kho) không được trùng nhau!', 'error');
    return;
  }

  const units = [
    { unitName: u1Name, rate: 1, price: u1Price },
    { unitName: u2Name, rate: u2Rate, price: u2Price },
    { unitName: u3Name, rate: u3Rate, price: u3Price }
  ];

  try {
    const res = await fetch(`${API_BASE}/danh-muc-va-canh-bao-han/thuoc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        barcode,
        name,
        ingredient,
        strength,
        dosageForm,
        shelfLocation,
        sdk,
        type,
        minStock,
        units,
        userId: user.userId
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message || 'Lỗi lưu thuốc vào CSDL', 'error');
      return;
    }
    showToast(data.message, 'success');
    await loadScreen1Data(true);
    closeDrugModal();
  } catch (err) {
    showToast('Không kết nối được tới máy chủ SQL Server để lưu thuốc mới!', 'error');
  }
}

/* Hàm filterLots: Lọc danh sách lô thuốc ở Tab 2 theo mã màu cảnh báo hạn dùng (ALL/RED/ORANGE/YELLOW/GREEN/LOCKED) */
function filterLots(filterCode, btnEl) {
  currentLotFilter = filterCode;
  document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
  btnEl.classList.add('active');
  renderLotTable();
}

/* Hàm renderLotTable: Hiển thị danh sách các lô thuốc kèm số ngày còn lại, nhãn màu cảnh báo và phân rã tồn kho */
function renderLotTable() {
  const tbody = document.getElementById('lotTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const lotKeyword = (document.getElementById('searchLotInput')?.value || '').trim().toLowerCase();
  const canApprove = getCurrentUser().canApproveStock;

  /* Dọn các mã lô đã không còn đủ điều kiện xuất hủy khỏi tập đang chọn */
  for (const id of [...selectedDestroyLotIds]) {
    const found = lots.find(l => l.lotId === id);
    if (!found || !isLotDestroyable(found)) {
      selectedDestroyLotIds.delete(id);
    }
  }

  const visibleEligibleIds = [];

  lots.forEach(lot => {
    const drug = drugs.find(d => d.id === lot.drugId);
    if (!drug) return;
    const alert = getLotAlertInfo(lot.exp, lot);
    if (currentLotFilter !== 'ALL') {
      if (currentLotFilter === 'ORANGE_60') {
        if (alert.code !== 'ORANGE' || alert.days > 60) return;
      } else if (currentLotFilter === 'ORANGE_90') {
        if (alert.code !== 'ORANGE' || alert.days <= 60) return;
      } else if (alert.code !== currentLotFilter) {
        return;
      }
    }

    if (lotKeyword) {
      const matchLot =
        lot.lotId.toLowerCase().includes(lotKeyword) ||
        lot.batchNo.toLowerCase().includes(lotKeyword) ||
        drug.name.toLowerCase().includes(lotKeyword) ||
        drug.ingredient.toLowerCase().includes(lotKeyword);
      if (!matchLot) return;
    }

    const eligible = isLotDestroyable(lot);
    if (eligible) visibleEligibleIds.push(lot.lotId);
    const isChecked = eligible && selectedDestroyLotIds.has(lot.lotId);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center;">
        <input
          type="checkbox"
          ${isChecked ? 'checked' : ''}
          ${eligible && canApprove ? '' : 'disabled'}
          onchange="toggleDestroyLotSelection('${lot.lotId}', this.checked)"
          title="${eligible ? 'Tích chọn lô này để xuất hủy / trả NCC' : 'Chỉ được chọn các lô quá hạn hoặc nguy cấp (<= 30 ngày) còn tồn kho'}"
        />
      </td>
      <td><strong>${lot.lotId}</strong> / <code>${lot.batchNo}</code></td>
      <td><strong>${drug.name}</strong><br/><small style="color:var(--muted)">${drug.ingredient}</small></td>
      <td><strong>${lot.exp}</strong><br/><small style="color:var(--muted)">NSX: ${lot.mfg || '—'}</small></td>
      <td><strong>${alert.days} ngày</strong></td>
      <td><span class="badge ${alert.badge}">${alert.label}</span></td>
      <td><strong>${lot.baseQty.toLocaleString('vi-VN')} ${drug.baseUnit}</strong></td>
      <td>${formatDecomposedStock(drug, lot.baseQty)}</td>
    `;
    tbody.appendChild(tr);
  });

  const chkAll = document.getElementById('chkSelectAllLots');
  if (chkAll) {
    chkAll.disabled = !canApprove || visibleEligibleIds.length === 0;
    chkAll.checked = visibleEligibleIds.length > 0 && visibleEligibleIds.every(id => selectedDestroyLotIds.has(id));
  }
}

/* Hàm toggleDestroyLotSelection: Chọn hoặc bỏ chọn 1 Số lô để đưa vào danh sách Xuất hủy / Trả NCC */
function toggleDestroyLotSelection(lotId, checked) {
  if (checked) {
    selectedDestroyLotIds.add(lotId);
  } else {
    selectedDestroyLotIds.delete(lotId);
  }
  renderLotTable();
  renderDestroyModalLotList();
}

/* Hàm toggleSelectAllDestroyLots: Chọn hoặc bỏ chọn tất cả lô đủ điều kiện trên bảng Tab 2 */
function toggleSelectAllDestroyLots(checked) {
  lots.filter(isLotDestroyable).forEach(l => {
    if (checked) selectedDestroyLotIds.add(l.lotId);
    else selectedDestroyLotIds.delete(l.lotId);
  });
  renderLotTable();
  renderDestroyModalLotList();
}

/* Hàm toggleModalSelectAllLots: Chọn hoặc bỏ chọn tất cả lô đủ điều kiện bên trong Modal xác nhận */
function toggleModalSelectAllLots(checked) {
  toggleSelectAllDestroyLots(checked);
}

/* Hàm renderDestroyModalLotList: Hiển thị danh sách các lô quá hạn & nguy cấp (<= 30 ngày) bên trong Modal để người dùng tích chọn */
function renderDestroyModalLotList() {
  const tbody = document.getElementById('destroyModalLotBody');
  const summaryEl = document.getElementById('destroySelectedSummary');
  const chkModalAll = document.getElementById('chkModalSelectAllLots');
  if (!tbody) return;

  const eligibleLots = lots.filter(isLotDestroyable);
  tbody.innerHTML = '';

  eligibleLots.forEach(lot => {
    const drug = drugs.find(d => d.id === lot.drugId);
    const alert = getLotAlertInfo(lot.exp, lot);
    const isChecked = selectedDestroyLotIds.has(lot.lotId);
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      toggleDestroyLotSelection(lot.lotId, !selectedDestroyLotIds.has(lot.lotId));
    };
    tr.innerHTML = `
      <td style="text-align: center;">
        <input
          type="checkbox"
          ${isChecked ? 'checked' : ''}
          onchange="toggleDestroyLotSelection('${lot.lotId}', this.checked)"
        />
      </td>
      <td><strong>${lot.lotId}</strong> / <code>${lot.batchNo}</code></td>
      <td><strong>${drug ? drug.name : lot.drugId}</strong></td>
      <td>${lot.exp}</td>
      <td><span class="badge ${alert.badge}">${alert.days} ngày</span></td>
      <td><strong>${lot.baseQty.toLocaleString('vi-VN')} ${drug ? drug.baseUnit : ''}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  const selectedLots = eligibleLots.filter(l => selectedDestroyLotIds.has(l.lotId));
  if (summaryEl) {
    if (selectedLots.length === 0) {
      summaryEl.textContent = 'Chưa chọn lô nào (Bắt buộc tích chọn ít nhất 1 Số lô muốn xuất)';
      summaryEl.style.color = 'var(--danger)';
    } else {
      const codes = selectedLots.map(l => `${l.lotId} (${l.batchNo})`).join(', ');
      summaryEl.textContent = `Đã chọn ${selectedLots.length}/${eligibleLots.length} lô: ${codes}`;
      summaryEl.style.color = 'var(--primary-dark)';
    }
  }
  if (chkModalAll) {
    chkModalAll.checked = eligibleLots.length > 0 && selectedLots.length === eligibleLots.length;
  }
}

/* Hàm closeDestroyLotModal: Đóng Modal chọn Số lô & xác nhận xuất hủy */
function closeDestroyLotModal() {
  const modal = document.getElementById('destroyLotModal');
  if (modal) modal.classList.remove('open');
}

/* Hàm createDestroyNoteFromExpired: Mở Modal bắt buộc chọn Số lô muốn xuất và xác nhận trước khi xuất hủy / trả NCC */
function createDestroyNoteFromExpired() {
  const user = getCurrentUser();
  if (!user.canApproveStock) {
    showToast(`Phân quyền: Tài khoản "${user.fullName}" không có quyền phê duyệt phiếu xuất hủy / trả NCC!`, 'error');
    return;
  }

  const eligibleLots = lots.filter(isLotDestroyable);
  if (eligibleLots.length === 0) {
    showToast('Hiện không có lô thuốc nào quá hạn hoặc nguy cấp (<= 30 ngày) còn tồn kho để xuất hủy!', 'warning');
    return;
  }

  const toolbarType = document.getElementById('exportTypeSelect')?.value || 'XUAT_HUY_HET_HAN';
  const mdlTypeEl = document.getElementById('mdlExportType');
  if (mdlTypeEl) {
    mdlTypeEl.value = toolbarType;
    mdlTypeEl.onchange = () => {
      const reasonEl = document.getElementById('mdlExportReason');
      if (reasonEl) {
        reasonEl.value = mdlTypeEl.value === 'XUAT_TRA_NCC'
          ? 'Lập phiếu xuất trả Nhà cung cấp GDP đối với các lô thuốc cận hạn nguy cấp <= 30 ngày / quá hạn.'
          : 'Thu hồi đưa vào tủ biệt trữ chờ tiêu hủy GPP đối với các lô quá hạn & nguy cấp <= 30 ngày.';
      }
    };
  }

  const reasonEl = document.getElementById('mdlExportReason');
  if (reasonEl) {
    reasonEl.value = toolbarType === 'XUAT_TRA_NCC'
      ? 'Lập phiếu xuất trả Nhà cung cấp GDP đối với các lô thuốc cận hạn nguy cấp <= 30 ngày / quá hạn.'
      : 'Thu hồi đưa vào tủ biệt trữ chờ tiêu hủy GPP đối với các lô quá hạn & nguy cấp <= 30 ngày.';
  }

  renderDestroyModalLotList();
  const modal = document.getElementById('destroyLotModal');
  if (modal) modal.classList.add('open');
}

/* Hàm confirmAndSubmitDestroyLots: Kiểm tra bắt buộc đã chọn Số lô, yêu cầu xác nhận lần cuối và gửi API xuất hủy / trả NCC */
async function confirmAndSubmitDestroyLots() {
  const user = getCurrentUser();
  if (!user.canApproveStock) {
    showToast(`Phân quyền: Tài khoản "${user.fullName}" không có quyền phê duyệt phiếu xuất hủy / trả NCC!`, 'error');
    return;
  }

  const eligibleLots = lots.filter(isLotDestroyable);
  const chosenLots = eligibleLots.filter(l => selectedDestroyLotIds.has(l.lotId));

  if (chosenLots.length === 0) {
    showToast('BẮT BUỘC: Vui lòng tích chọn ít nhất một Số lô thuốc muốn xuất hủy / trả NCC!', 'error');
    return;
  }

  const exportType = document.getElementById('mdlExportType')?.value || 'XUAT_HUY_HET_HAN';
  const reason = (document.getElementById('mdlExportReason')?.value || '').trim();
  if (!reason) {
    showToast('Vui lòng nhập Lý do xuất hủy / trả Nhà cung cấp!', 'error');
    return;
  }

  const exportTypeLabel = exportType === 'XUAT_TRA_NCC'
    ? 'XUẤT TRẢ NHÀ CUNG CẤP GDP'
    : 'XUẤT HỦY THUỐC HẾT HẠN / NGUY CẤP GPP';

  const lotDetailLines = chosenLots.map(l => {
    const drug = drugs.find(d => d.id === l.drugId);
    return `• ${l.lotId} (Số lô: ${l.batchNo}) - ${drug ? drug.name : l.drugId}: ${l.baseQty} ${drug ? drug.baseUnit : ''} (HSD: ${l.exp})`;
  }).join('\n');

  const isConfirmed = window.confirm(
    `XÁC NHẬN ${exportTypeLabel}\n\n` +
    `Bạn có chắc chắn muốn xuất kho và trừ tồn về 0 đối với ${chosenLots.length} lô đã chọn sau đây không?\n\n` +
    `${lotDetailLines}\n\n` +
    `Lý do: ${reason}`
  );
  if (!isConfirmed) {
    return;
  }

  const lotIds = chosenLots.map(l => l.lotId);

  try {
    const res = await fetch(`${API_BASE}/danh-muc-va-canh-bao-han/xuat-huy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exportType,
        reason,
        lotIds,
        userId: user.userId
      })
    });
    const data = await res.json();
    if (data.ok) {
      selectedDestroyLotIds.clear();
      closeDestroyLotModal();
      showToast(data.message, 'warning');
      await loadScreen1Data(true);
      return;
    }
    showToast(data.message || 'Lỗi xuất hủy trên SQL Server', 'error');
  } catch (err) {
    showToast('Không kết nối được tới máy chủ SQL Server để lập phiếu xuất hủy!', 'error');
  }
}

/* Khởi chạy Màn hình 3 và đồng bộ trạng thái khóa nút Thêm thuốc & nút Xuất hủy khi đổi tài khoản RBAC */
window.addEventListener('DOMContentLoaded', () => {
  initCommonRoleSwitcher((role, userObj) => {
    const canEditPrice = userObj ? userObj.canEditPrice : (role === 'ACT-01');
    const canApproveStock = userObj ? userObj.canApproveStock : (role === 'ACT-01');
    const btnAddDrug = document.getElementById('btnAddDrug');
    if (btnAddDrug) btnAddDrug.disabled = !canEditPrice;
    const btnDestroyExpired = document.getElementById('btnDestroyExpired');
    if (btnDestroyExpired) btnDestroyExpired.disabled = !canApproveStock;
    const exportTypeSelect = document.getElementById('exportTypeSelect');
    if (exportTypeSelect) exportTypeSelect.disabled = !canApproveStock;
    if (!canApproveStock) {
      selectedDestroyLotIds.clear();
      closeDestroyLotModal();
    }
    renderLotTable();
  });
  loadScreen1Data();
  registerAutoDbSync(loadScreen1Data);
});
