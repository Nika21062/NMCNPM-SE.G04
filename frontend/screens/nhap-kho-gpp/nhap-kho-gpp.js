/* ============================================================================
   LOGIC NGHIỆP VỤ MÀN HÌNH 2: NHẬP KHO & KIỂM NHẬP CẢM QUAN GPP (nhap-kho-gpp.js)
   Chức năng:
   1. Tải danh sách Nhà phân phối đạt chuẩn GDP, Danh mục thuốc + ĐVT và Lịch sử
      Phiếu nhập kho + Chi tiết phiếu nhập (tbl_phieu_nhap_kho & tbl_ct_phieu_nhap)
   2. Tự động nhân tỷ lệ quy đổi từ đơn vị nhập về đơn vị cơ bản nhỏ nhất
   3. Thêm nhanh quy cách đóng gói ĐVT mới (theo quyền cho_phep_sua_gia trong DB)
   4. Kiểm tra chặn nhập thuốc hết hạn (NR06), chặn nhà phân phối hết hạn GDP,
      cảnh báo lô cận hạn < 180 ngày và yêu cầu nhập lý do duyệt đặc cách
   5. Gửi duyệt kiểm nhập cảm quan (Bước 1 - lưu DB) và Phê duyệt cộng tồn kho (Bước 2)
   ============================================================================ */

/* Khởi tạo biến trạng thái (Lấy 100% trực tiếp từ SQL Server) và danh sách dòng phiếu nhập dự thảo */
let suppliers = [];
let drugs = [];
let receipts = [];
let importDraftLines = [];
let importState = 'NHAP_NHAP';

/* Hàm loadScreen2Data: Tải trực tiếp dữ liệu Nhà cung cấp GDP, Danh mục thuốc và Lịch sử phiếu nhập từ API SQL Server */
async function loadScreen2Data(silent = false) {
  const prevSupplier = document.getElementById('impSupplier')?.value;
  const prevDrug = document.getElementById('impDrugSelect')?.value;
  const prevUnit = document.getElementById('impUnitSelect')?.value;

  try {
    const res = await fetch(`${API_BASE}/nhap-kho-gpp/data?_t=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) {
      suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
      drugs = Array.isArray(data.drugs) ? data.drugs : [];
      receipts = Array.isArray(data.receipts) ? data.receipts : [];
    } else if (!silent) {
      showToast('Lỗi truy vấn SQL Server: ' + (data.message || 'Không xác định'), 'error');
    }
  } catch (err) {
    if (!silent) {
      showToast('Không kết nối được tới máy chủ Backend SQL Server (http://localhost:3000)! Vui lòng bật server.', 'error');
    }
  }

  populateSupplierSelect(prevSupplier);
  populateImportDrugSelect(prevDrug, prevUnit);
  renderImportLines();
  renderImportReceiptsHistory();
}

/* Hàm populateSupplierSelect: Đổ danh sách Nhà phân phối GDP vào thẻ select */
function populateSupplierSelect(preferredId) {
  const sel = document.getElementById('impSupplier');
  if (!sel) return;
  const optionsHtml = suppliers
    .map(s => `<option value="${s.id}" data-status="${s.status}" data-exp="${s.expDate || ''}">${s.name} (${s.status === 'CON_HIEU_LUC' ? 'GDP Còn hiệu lực - HSD: ' + (s.expDate || 'N/A') : 'GDP HẾT HẠN'})</option>`)
    .join('');
  sel.innerHTML = `<option value="">-- Chọn nhà phân phối --</option>` + optionsHtml;
  if (preferredId && suppliers.some(s => s.id === preferredId)) {
    sel.value = preferredId;
  } else {
    sel.value = '';
  }
}

/* Hàm populateImportDrugSelect: Đổ danh sách thuốc vào thẻ select chọn thuốc nhập kho */
function populateImportDrugSelect(preferredDrugId, preferredUnitName) {
  const sel = document.getElementById('impDrugSelect');
  if (!sel) return;
  const optionsHtml = drugs.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  sel.innerHTML = `<option value="">-- Chọn thuốc nhập kho --</option>` + optionsHtml;
  if (preferredDrugId && drugs.some(d => d.id === preferredDrugId)) {
    sel.value = preferredDrugId;
  } else {
    sel.value = '';
  }
  onImportDrugChange(preferredUnitName);
}

/* Hàm onImportDrugChange: Cập nhật danh sách Đơn vị tính nhập tương ứng khi người dùng chọn thuốc */
function onImportDrugChange(preferredUnitName) {
  const drugId = document.getElementById('impDrugSelect').value;
  const unitSel = document.getElementById('impUnitSelect');
  const previewEl = document.getElementById('impBaseQtyPreview');
  const drug = drugs.find(d => d.id === drugId);
  if (!drug) {
    if (unitSel) unitSel.innerHTML = `<option value="">-- Chọn đơn vị tính --</option>`;
    if (previewEl) previewEl.value = '';
    return;
  }
  /* Ưu tiên hiển thị đơn vị lớn nhất (Hộp / Thùng) lên đầu khi nhập kho */
  const sortedUnits = [...drug.units].sort((a, b) => b.rate - a.rate);
  const optionsHtml = sortedUnits
    .map(u => `<option value="${u.unitName}" data-rate="${u.rate}">${u.unitName} (1 ${u.unitName} = ${u.rate} ${drug.baseUnit})</option>`)
    .join('');
  unitSel.innerHTML = `<option value="">-- Chọn đơn vị tính --</option>` + optionsHtml;
  if (preferredUnitName && sortedUnits.some(u => u.unitName === preferredUnitName)) {
    unitSel.value = preferredUnitName;
  } else {
    unitSel.value = '';
  }
  calcImportConversion();
}

/* Hàm calcImportConversion: Tự động tính Số lượng quy đổi cơ bản = Số lượng nhập * Tỷ lệ quy đổi */
function calcImportConversion() {
  const drugId = document.getElementById('impDrugSelect').value;
  const drug = drugs.find(d => d.id === drugId);
  const unitSel = document.getElementById('impUnitSelect');
  const previewEl = document.getElementById('impBaseQtyPreview');
  if (!previewEl) return;

  if (!drug || !unitSel || !unitSel.value) {
    previewEl.value = '';
    return;
  }
  const selectedOpt = unitSel.options[unitSel.selectedIndex];
  const rate = Number(selectedOpt ? selectedOpt.getAttribute('data-rate') : 0);
  const qty = Number(document.getElementById('impQty').value || 0);
  if (qty <= 0 || rate <= 0) {
    previewEl.value = '';
    return;
  }
  const baseQty = qty * rate;
  previewEl.value = `+${baseQty.toLocaleString('vi-VN')} ${drug.baseUnit}`;
}

/* Hàm openQuickUnitModal: Mở hộp thoại thêm nhanh quy cách ĐVT mới (Kiểm tra quyền cho_phep_sua_gia trong DB) */
function openQuickUnitModal() {
  const user = getCurrentUser();
  if (!user.canEditPrice) {
    showToast(`Phân quyền: Tài khoản "${user.fullName}" không có quyền thêm/cấu hình quy cách ĐVT và giá bán niêm yết!`, 'error');
    return;
  }
  const drugId = document.getElementById('impDrugSelect').value;
  const drug = drugs.find(d => d.id === drugId);
  if (!drug) {
    showToast('Vui lòng chọn Thuốc nhập kho trước khi thêm nhanh quy cách ĐVT!', 'warning');
    return;
  }
  document.getElementById('quDrugName').textContent = drug.name;
  document.getElementById('quBaseUnit').textContent = drug.baseUnit;
  document.getElementById('quUnitName').value = '';
  document.getElementById('quRetailPrice').value = '';
  document.getElementById('quSubPackCount').value = '';
  document.getElementById('quPillsPerPack').value = '';
  document.getElementById('quFinalRate').value = '';
  document.getElementById('quickUnitModal').classList.add('open');
}

/* Hàm closeQuickUnitModal: Đóng hộp thoại thêm nhanh quy cách ĐVT */
function closeQuickUnitModal() {
  document.getElementById('quickUnitModal').classList.remove('open');
}

/* Hàm calcQuickPackRate: Nhân tự động Số vỉ trong hộp * Số viên trong vỉ để ra tỷ lệ quy đổi */
function calcQuickPackRate() {
  const packs = Number(document.getElementById('quSubPackCount').value || 0);
  const pills = Number(document.getElementById('quPillsPerPack').value || 0);
  if (packs > 0 && pills > 0) {
    document.getElementById('quFinalRate').value = packs * pills;
  } else {
    document.getElementById('quFinalRate').value = '';
  }
}

/* Hàm saveQuickUnit: Lưu quy cách ĐVT mới vào bảng tbl_quy_doi_don_vi trên SQL Server và chọn ngay vào phiếu nhập */
async function saveQuickUnit() {
  const drugId = document.getElementById('impDrugSelect').value;
  const drug = drugs.find(d => d.id === drugId);
  const newUnitName = document.getElementById('quUnitName').value.trim();
  const newRate = Number(document.getElementById('quFinalRate').value);
  const newPrice = Number(document.getElementById('quRetailPrice').value);
  const user = getCurrentUser();

  if (!newUnitName || newRate < 1 || newPrice <= 0) {
    showToast('Vui lòng nhập Tên quy cách, Tỷ lệ quy đổi >= 1 và Giá bán lẻ > 0!', 'error');
    return;
  }
  if (drug.units.some(u => u.unitName.toLowerCase() === newUnitName.toLowerCase())) {
    showToast(`Quy cách "${newUnitName}" đã tồn tại trong thuốc ${drug.name}!`, 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/nhap-kho-gpp/them-nhanh-dvt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drugId,
        unitName: newUnitName,
        rate: newRate,
        price: newPrice,
        userId: user.userId
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message || 'Lỗi thêm quy cách ĐVT', 'error');
      return;
    }
  } catch (err) {
    showToast('Không kết nối được tới SQL Server để lưu quy cách ĐVT mới!', 'error');
    return;
  }

  await loadScreen2Data(true);
  document.getElementById('impDrugSelect').value = drugId;
  onImportDrugChange(newUnitName);
  closeQuickUnitModal();
  showToast(`Đã thêm quy cách "${newUnitName}" (1 ${newUnitName} = ${newRate} ${drug.baseUnit}) vào bảng tbl_quy_doi_don_vi trên SQL Server!`, 'success');
}

/* Hàm addImportLine: Kiểm tra hợp lệ GDP/Hạn dùng và thêm dòng lô thuốc vào bảng dự thảo Phiếu nhập */
function addImportLine() {
  const supSel = document.getElementById('impSupplier');
  if (!supSel || !supSel.value) {
    showToast('Vui lòng chọn Nhà phân phối đạt chuẩn GDP!', 'error');
    return;
  }
  const selectedSupOpt = supSel.options[supSel.selectedIndex];
  if (selectedSupOpt && selectedSupOpt.getAttribute('data-status') === 'HET_HIEU_LUC') {
    showToast('Nhà phân phối này đã HẾT HẠN chứng nhận GDP! Hệ thống chặn nhập hàng theo chuẩn GPP.', 'error');
    return;
  }

  const drugId = document.getElementById('impDrugSelect').value;
  const drug = drugs.find(d => d.id === drugId);
  if (!drug) {
    showToast('Vui lòng chọn Thuốc nhập kho!', 'error');
    return;
  }
  const unitName = document.getElementById('impUnitSelect').value;
  if (!unitName) {
    showToast('Vui lòng chọn Đơn vị tính nhập!', 'error');
    return;
  }
  const unitObj = drug.units.find(u => u.unitName === unitName) || drug.units[0];
  const qty = Number(document.getElementById('impQty').value);
  const batchNo = document.getElementById('impBatchNo').value.trim();
  const mfg = document.getElementById('impMfgDate').value;
  const exp = document.getElementById('impExpDate').value;
  const price = Number(document.getElementById('impPrice').value);

  if (!batchNo || !mfg || !exp || qty <= 0 || price <= 0) {
    showToast('Vui lòng nhập đầy đủ Số lượng > 0, Số lô, NSX, Hạn dùng và Đơn giá nhập!', 'error');
    return;
  }

  const daysLeft = diffDaysFromToday(exp);
  if (daysLeft <= 0 || new Date(exp) <= new Date(mfg)) {
    showToast('Hạn sử dụng phải lớn hơn ngày sản xuất và ngày nhập kho hiện tại! Tuyệt đối cấm nhập thuốc hết hạn.', 'error');
    return;
  }

  let expiryNote = '<span class="badge badge-green">Đạt chuẩn (&ge; 180 ngày)</span>';
  let isShortExpiry = false;
  if (daysLeft < 180) {
    isShortExpiry = true;
    expiryNote = `<span class="badge badge-orange">Cận hạn (${daysLeft} ngày &lt; 180 ngày - Cần duyệt đặc cách)</span>`;
    showToast(`Lô ${batchNo} chỉ còn ${daysLeft} ngày (< 180 ngày). Bắt buộc nhập lý do duyệt đặc cách!`, 'warning');
  }

  importDraftLines.push({
    drugId,
    drugName: drug.name,
    baseUnit: drug.baseUnit,
    batchNo,
    mfg,
    exp,
    unitName,
    rate: unitObj.rate,
    qty,
    baseQty: qty * unitObj.rate,
    price,
    lineTotal: qty * price,
    expiryNote,
    isShortExpiry
  });

  /* Xóa trống các ô nhập lô sau khi thêm dòng */
  document.getElementById('impDrugSelect').value = '';
  onImportDrugChange();
  document.getElementById('impQty').value = '';
  document.getElementById('impBaseQtyPreview').value = '';
  document.getElementById('impBatchNo').value = '';
  document.getElementById('impMfgDate').value = '';
  document.getElementById('impExpDate').value = '';
  document.getElementById('impPrice').value = '';

  renderImportLines();
  showToast(`Đã thêm lô ${batchNo} (${qty} ${unitName} = +${qty * unitObj.rate} ${drug.baseUnit}) vào dự thảo phiếu nhập.`, 'success');
}

/* Hàm removeImportLine: Xóa một dòng lô thuốc khỏi bảng dự thảo Phiếu nhập */
function removeImportLine(idx) {
  importDraftLines.splice(idx, 1);
  renderImportLines();
}

/* Hàm renderImportLines: Hiển thị các dòng lô thuốc trong bảng dự thảo Phiếu nhập và bật/tắt ô lý do đặc cách */
function renderImportLines() {
  const tbody = document.getElementById('importLinesBody');
  const specialGroup = document.getElementById('specialReasonGroup');
  if (!tbody) return;

  const hasShortExpiry = importDraftLines.some(l => l.isShortExpiry);
  if (specialGroup) {
    specialGroup.style.display = hasShortExpiry ? 'flex' : 'none';
  }

  if (importDraftLines.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--muted);">Chưa có dòng hàng nào. Hãy bấm "+ Thêm dòng lô vào Phiếu nhập" ở trên.</td></tr>`;
    return;
  }

  tbody.innerHTML = importDraftLines.map((l, idx) => `
    <tr>
      <td><strong>${l.drugName}</strong></td>
      <td><code>${l.batchNo}</code></td>
      <td>${l.mfg} &rarr; <strong>${l.exp}</strong></td>
      <td>${l.unitName} (1:${l.rate})</td>
      <td><strong>${l.qty}</strong></td>
      <td><strong style="color:var(--primary-dark)">+${l.baseQty.toLocaleString('vi-VN')} ${l.baseUnit}</strong></td>
      <td>${l.lineTotal.toLocaleString('vi-VN')}đ</td>
      <td>${l.expiryNote}</td>
      <td><button type="button" class="btn btn-outline" style="padding:4px 8px; color:var(--danger);" onclick="removeImportLine(${idx})">X</button></td>
    </tr>
  `).join('');
}

/* Hàm resetImportHeaderForm: Xóa trống các ô chứng từ và checklist sau khi lưu phiếu */
function resetImportHeaderForm() {
  const supEl = document.getElementById('impSupplier');
  const invNoEl = document.getElementById('impInvoiceNo');
  const invDateEl = document.getElementById('impInvoiceDate');
  const fileEl = document.getElementById('impFileUrl');
  const reasonEl = document.getElementById('impSpecialReason');
  const chk1El = document.getElementById('chkGpp1');
  const chk2El = document.getElementById('chkGpp2');
  const chk3El = document.getElementById('chkGpp3');

  if (supEl) supEl.value = '';
  if (invNoEl) invNoEl.value = '';
  if (invDateEl) invDateEl.value = '';
  if (fileEl) fileEl.value = '';
  if (reasonEl) reasonEl.value = '';
  if (chk1El) chk1El.checked = false;
  if (chk2El) chk2El.checked = false;
  if (chk3El) chk3El.checked = false;
}

/* Hàm submitForInspection: Bước 1 (Dược sĩ) xác nhận đủ 3 mục Checklist cảm quan GPP và lưu phiếu vào SQL Server */
async function submitForInspection() {
  const supplierId = document.getElementById('impSupplier').value;
  const invoiceNo = document.getElementById('impInvoiceNo').value.trim();
  const invoiceDate = document.getElementById('impInvoiceDate').value;
  const fileUrl = document.getElementById('impFileUrl').value.trim();

  if (!supplierId || !invoiceNo || !invoiceDate) {
    showToast('Vui lòng chọn Nhà phân phối, nhập Số Hóa đơn GTGT và Ngày hóa đơn!', 'error');
    return;
  }
  if (importDraftLines.length === 0) {
    showToast('Phiếu nhập chưa có lô thuốc nào!', 'error');
    return;
  }
  const chk1 = document.getElementById('chkGpp1').checked;
  const chk2 = document.getElementById('chkGpp2').checked;
  const chk3 = document.getElementById('chkGpp3').checked;
  if (!chk1 || !chk2 || !chk3) {
    showToast('Bắt buộc tích xác nhận đủ 3 mục Checklist Kiểm nhập cảm quan chuẩn GPP!', 'error');
    return;
  }

  const hasShortExpiry = importDraftLines.some(l => l.isShortExpiry);
  const specialReason = (document.getElementById('impSpecialReason')?.value || '').trim();
  if (hasShortExpiry && !specialReason) {
    showToast('Phiếu nhập có lô cận hạn (< 180 ngày), bắt buộc nhập Lý do trình duyệt đặc cách!', 'error');
    return;
  }

  const user = getCurrentUser();

  try {
    const res = await fetch(`${API_BASE}/nhap-kho-gpp/gui-kiem-nhap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId,
        invoiceNo,
        invoiceDate,
        fileUrl,
        specialReason: hasShortExpiry ? specialReason : null,
        lines: importDraftLines,
        checklist: { chk1, chk2, chk3 },
        userId: user.userId
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message || 'Lỗi gửi duyệt kiểm nhập', 'error');
      return;
    }

    importState = data.status || (hasShortExpiry ? 'CHO_DUYET_DAC_CACH' : 'CHO_KIEM_NHAP');
    showToast(data.message, 'warning');
    importDraftLines = [];
    resetImportHeaderForm();
    await loadScreen2Data(true);
  } catch (err) {
    showToast('Không kết nối được tới SQL Server để lưu phiếu kiểm nhập!', 'error');
  }
}

/* Hàm approveImportStock: Bước 2 (Chủ nhà thuốc / Quản lý) phê duyệt phiếu nhập kho và cộng tồn kho cơ bản vào SQL Server */
async function approveImportStock() {
  const user = getCurrentUser();
  if (!user.canApproveStock) {
    showToast(`Từ chối truy cập: Tài khoản "${user.fullName}" không có quyền Phê duyệt nhập kho!`, 'error');
    return;
  }
  const supplierId = document.getElementById('impSupplier').value;
  const invoiceNo = document.getElementById('impInvoiceNo').value.trim();
  const invoiceDate = document.getElementById('impInvoiceDate').value;
  const fileUrl = document.getElementById('impFileUrl').value.trim();

  if (!supplierId || !invoiceNo || !invoiceDate) {
    showToast('Vui lòng chọn Nhà phân phối, nhập Số Hóa đơn GTGT và Ngày hóa đơn!', 'error');
    return;
  }
  if (importDraftLines.length === 0) {
    showToast('Không có dòng lô thuốc nào trong bảng dự thảo để phê duyệt!', 'error');
    return;
  }
  const chk1 = document.getElementById('chkGpp1').checked;
  const chk2 = document.getElementById('chkGpp2').checked;
  const chk3 = document.getElementById('chkGpp3').checked;
  if (!chk1 || !chk2 || !chk3) {
    showToast('Không thể phê duyệt khi Checklist Kiểm nhập cảm quan GPP chưa đạt 100%!', 'error');
    return;
  }

  const hasShortExpiry = importDraftLines.some(l => l.isShortExpiry);
  const specialReason = (document.getElementById('impSpecialReason')?.value || '').trim();
  if (hasShortExpiry && !specialReason) {
    showToast('Vui lòng nhập Lý do duyệt đặc cách cho lô cận hạn (< 180 ngày) trước khi phê duyệt!', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/nhap-kho-gpp/phe-duyet-nhap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId,
        invoiceNo,
        invoiceDate,
        fileUrl,
        specialReason: hasShortExpiry ? specialReason : null,
        lines: importDraftLines,
        checklist: { chk1, chk2, chk3 },
        userId: user.userId
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message || 'Lỗi phê duyệt nhập kho', 'error');
      return;
    }
    showToast(data.message, 'success');
  } catch (err) {
    showToast('Không kết nối được tới SQL Server để phê duyệt nhập kho!', 'error');
    return;
  }

  importState = 'DA_DUYET_NHAP';
  importDraftLines = [];
  resetImportHeaderForm();
  await loadScreen2Data(true);
}

/* Hàm approvePendingReceiptFromHistory: Phê duyệt một phiếu nhập đang ở trạng thái CHO_KIEM_NHAP / CHO_DUYET_DAC_CACH ngay từ bảng Lịch sử */
async function approvePendingReceiptFromHistory(receiptId) {
  const user = getCurrentUser();
  if (!user.canApproveStock) {
    showToast(`Từ chối truy cập (RBAC): Tài khoản "${user.fullName}" không có quyền Phê duyệt phiếu nhập kho!`, 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/nhap-kho-gpp/duyet-phieu-cho`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiptId,
        userId: user.userId
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message || 'Lỗi phê duyệt phiếu nhập', 'error');
      return;
    }
    showToast(data.message, 'success');
    await loadScreen2Data(true);
  } catch (err) {
    showToast('Không kết nối được tới SQL Server để phê duyệt phiếu chờ!', 'error');
  }
}

/* Hàm renderImportReceiptsHistory: Hiển thị bảng Lịch sử Phiếu nhập kho & Chi tiết các lô nhập (tbl_phieu_nhap_kho & tbl_ct_phieu_nhap) */
function renderImportReceiptsHistory() {
  const tbody = document.getElementById('importHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const kw = (document.getElementById('searchReceiptHistoryInput')?.value || '').trim().toLowerCase();
  const user = getCurrentUser();

  const filtered = receipts.filter(r => {
    if (!kw) return true;
    const matchHeader =
      (r.receiptCode || '').toLowerCase().includes(kw) ||
      (r.invoiceNo || '').toLowerCase().includes(kw) ||
      (r.supplierName || '').toLowerCase().includes(kw) ||
      (r.status || '').toLowerCase().includes(kw);
    const matchDetails = Array.isArray(r.details) && r.details.some(d =>
      (d.drugName || '').toLowerCase().includes(kw) ||
      (d.batchNo || '').toLowerCase().includes(kw) ||
      (d.lotCode || '').toLowerCase().includes(kw)
    );
    return matchHeader || matchDetails;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding: 20px; color: var(--muted);">
          Không tìm thấy phiếu nhập kho nào khớp với từ khóa tìm kiếm.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(r => {
    const isApproved = r.status === 'DA_DUYET_NHAP';
    const isPending = r.status === 'CHO_KIEM_NHAP' || r.status === 'CHO_DUYET_NHAP' || r.status === 'CHO_DUYET_DAC_CACH';

    const statusBadgeClass = isApproved
      ? 'badge-green'
      : (isPending ? 'badge-yellow' : 'badge-locked');

    const checklistHtml = `
      <div style="font-size:11.5px; margin-top:4px; color:#1e3a8a;">
        GPP:
        <span title="Bao bì nguyên vẹn">${r.chk1 ? '✅[1]' : '❌[1]'}</span>
        <span title="Nhãn lô/HSD khớp HĐ">${r.chk2 ? '✅[2]' : '❌[2]'}</span>
        <span title="Nhiệt độ đạt chuẩn">${r.chk3 ? '✅[3]' : '❌[3]'}</span>
      </div>
      ${r.specialReason ? `<div style="font-size:11px; color:var(--warning); font-weight:600; margin-top:3px;">⚠️ Đặc cách: ${r.specialReason}</div>` : ''}
    `;

    const detailsHtml = Array.isArray(r.details) && r.details.length > 0
      ? r.details.map(d => `
          <div style="padding:7px 9px; border:1px solid #dbeafe; background:#f8fbff; border-radius:6px; margin-bottom:6px; font-size:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <span>
                <strong>${d.drugName}</strong>
                <span class="badge badge-otc" style="font-size:10.5px;">${d.lotCode} / Lô: ${d.batchNo}</span>
              </span>
              <span style="color:var(--muted); font-size:11.5px;">NSX: ${d.mfgDate || '—'} &rarr; HSD: <strong>${d.expDate}</strong></span>
            </div>
            <div style="margin-top:4px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
              <span>
                SL nhập: <strong>${d.importQty} ${d.unitName}</strong> (Tỷ lệ 1:${d.rate})
                &rarr; Quy đổi cơ bản: <strong style="color:var(--primary-dark);">+${d.baseQty.toLocaleString('vi-VN')} ${d.baseUnit}</strong>
              </span>
              <span>
                Đơn giá nhập: <strong>${d.importPrice.toLocaleString('vi-VN')}đ/${d.unitName}</strong>
                (Giá vốn cơ bản: ${d.baseCost.toLocaleString('vi-VN')}đ/${d.baseUnit} | VAT: ${d.vatPercent}%)
                = <strong style="color:var(--success);">${d.lineTotal.toLocaleString('vi-VN')}đ</strong>
              </span>
            </div>
            <div style="margin-top:3px; font-size:11px; color:#475569;">
              Kiểm soát hạn GPP: <strong>${d.gppNote}</strong>
            </div>
          </div>
        `).join('')
      : `<span style="color:var(--muted); font-size:12px;">Chưa có chi tiết dòng nhập.</span>`;

    const statusLabelMap = {
      DA_DUYET_NHAP: 'Đã duyệt nhập',
      CHO_KIEM_NHAP: 'Chờ kiểm nhập',
      CHO_DUYET_NHAP: 'Chờ duyệt nhập',
      CHO_DUYET_DAC_CACH: 'Chờ duyệt đặc cách',
      NHAP_NHAP: 'Nháp',
      DA_HUY: 'Đã hủy'
    };
    const displayStatus = statusLabelMap[r.status] || r.status;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${r.receiptCode}</strong><br/>
        <small style="color:var(--muted);">Lập: ${r.createdAt || r.invoiceDate}</small><br/>
        <small style="color:var(--primary-dark);">📎 ${r.fileUrl || 'hoadon_vat.pdf'}</small>
      </td>
      <td>
        <strong>${r.supplierName}</strong><br/>
        <small style="color:var(--muted);">Số GDP: ${r.gdpCert || 'Đạt chuẩn'}</small><br/>
        <span style="font-size:12px;">HĐ VAT: <strong>${r.invoiceNo}</strong> (${r.invoiceDate})</span>
      </td>
      <td>
        <div>Lập: <strong>${r.createdByName}</strong></div>
        <div>Duyệt: <strong>${r.approvedByName}</strong></div>
        ${checklistHtml}
      </td>
      <td>${detailsHtml}</td>
      <td>
        <strong style="font-size:14px; color:var(--primary-dark);">${r.totalAmount.toLocaleString('vi-VN')} VNĐ</strong>
      </td>
      <td>
        <span class="badge ${statusBadgeClass}">${displayStatus}</span>
        ${isPending ? `
          <div style="margin-top:8px;">
            <button
              type="button"
              class="btn btn-success"
              style="padding:5px 10px; font-size:11.5px;"
              ${!user.canApproveStock ? 'disabled title="Chỉ vai trò có quyền duyệt kho mới được phê duyệt"' : ''}
              onclick="approvePendingReceiptFromHistory(${r.id})"
            >
              ✓ Duyệt cộng tồn
            </button>
          </div>
        ` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* Khởi chạy Màn hình 2 và lắng nghe sự kiện đổi tài khoản RBAC ở góc dưới bên trái */
window.addEventListener('DOMContentLoaded', () => {
  initCommonRoleSwitcher((role, userObj) => {
    const canApprove = userObj ? userObj.canApproveStock : (role === 'ACT-01');
    const canEditPrice = userObj ? userObj.canEditPrice : (role === 'ACT-01');
    const btnApproveImport = document.getElementById('btnApproveImport');
    if (btnApproveImport) btnApproveImport.disabled = !canApprove;
    const btnQuickAddUnit = document.getElementById('btnQuickAddUnit');
    if (btnQuickAddUnit) btnQuickAddUnit.disabled = !canEditPrice;
    renderImportReceiptsHistory();
  });
  loadScreen2Data();
  registerAutoDbSync(loadScreen2Data);
});
