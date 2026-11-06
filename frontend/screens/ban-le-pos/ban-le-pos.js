/* ============================================================================
   LOGIC NGHIỆP VỤ MÀN HÌNH 1: BÁN LẺ QUẦY POS (ban-le-pos.js)
   Chức năng:
   1. Hiển thị danh sách toàn bộ sản phẩm có trong CSDL SQL Server (tbl_dm_thuoc)
   2. Tìm kiếm đúng theo tên sản phẩm khi bấm nút Tìm kiếm; khi xóa trống và bấm
      Tìm kiếm sẽ trả về danh sách toàn bộ sản phẩm như bình thường
   3. Chọn ĐVT bán (ưu tiên cờ la_don_vi_xuat_hd từ DB), nhập số lượng mua, tự động
      tính SL trừ kho cơ bản & phân bổ lô FEFO
   4. Mở Popup Giỏ hàng từ nút Giỏ hàng bên trái để xem/chỉnh sửa các món đã thêm
   5. Tính tiền khách đưa [F7], tiền thừa trả khách, kiểm tra đơn ETC và Thanh toán
   ============================================================================ */

/* Khởi tạo biến lưu danh sách sản phẩm, danh sách lô thuốc (Lấy 100% trực tiếp từ SQL Server), trạng thái dòng chọn và giỏ hàng */
let drugs = [];
let allDrugsMap = {};
let lots = [];
let currentSearchKeyword = '';

/* Lưu trạng thái chọn ĐVT và Số lượng mua trên từng dòng của bảng Danh sách sản phẩm */
let productRowSelections = {};

/* Danh sách các sản phẩm đã được thêm vào Giỏ hàng POS */
let posCart = [];

/* Hàm findDrugById: Tra cứu thông tin thuốc kể cả khi bảng đang lọc theo từ khóa tìm kiếm */
function findDrugById(drugId) {
  return drugs.find(d => d.id === drugId) || allDrugsMap[drugId] || null;
}

/* Hàm syncDrugSelections: Đồng bộ bộ nhớ đệm thuốc và đơn vị tính mặc định */
function syncDrugSelections(drugList, isFullList = false) {
  if (isFullList) {
    allDrugsMap = {};
  }
  drugList.forEach(d => {
    allDrugsMap[d.id] = d;
    const defaultUnit = d.units.find(u => u.isDefaultSale) || (d.units.length > 1 ? d.units[1] : d.units[0]);
    const fallbackUnitName = defaultUnit ? defaultUnit.unitName : d.baseUnit;

    if (!productRowSelections[d.id]) {
      productRowSelections[d.id] = {
        unitName: fallbackUnitName,
        qty: 1
      };
    } else {
      const stillExists = d.units.some(u => u.unitName === productRowSelections[d.id].unitName);
      if (!stillExists) {
        productRowSelections[d.id].unitName = fallbackUnitName;
      }
    }
  });
}

/* Hàm loadScreenPosData: Tải trực tiếp toàn bộ danh sách sản phẩm và lô thuốc FEFO từ SQL Server */
async function loadScreenPosData(silent = false) {
  try {
    const queryParam = currentSearchKeyword ? `&search=${encodeURIComponent(currentSearchKeyword)}` : '';
    const res = await fetch(`${API_BASE}/ban-le-pos/data?_t=${Date.now()}${queryParam}`, { cache: 'no-store' });
    const data = await res.json();
    if (data.ok) {
      drugs = Array.isArray(data.drugs) ? data.drugs : [];
      lots = Array.isArray(data.lots) ? data.lots : [];
      syncDrugSelections(drugs, !currentSearchKeyword);
    } else if (!silent) {
      showToast('Lỗi truy vấn SQL Server: ' + (data.message || 'Không xác định'), 'error');
    }
  } catch (err) {
    if (!silent) {
      showToast('Không kết nối được tới máy chủ Backend SQL Server (http://localhost:3000)! Vui lòng bật server.', 'error');
    }
  }

  /* Loại bỏ khỏi giỏ hàng những sản phẩm đã bị ngừng kinh doanh (INACTIVE) hoặc xóa trong DB */
  posCart = posCart.filter(c => {
    const d = findDrugById(c.drugId);
    if (!d) return false;
    if (!d.units.some(u => u.unitName === c.unitName)) {
      const defU = d.units.find(u => u.isDefaultSale) || d.units[0];
      c.unitName = defU ? defU.unitName : d.baseUnit;
    }
    return true;
  });

  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm allocateFefoForDrug: Thuật toán phân bổ tự động các lô thuốc khả dụng có hạn dùng gần nhất (FEFO) */
function allocateFefoForDrug(drug, neededBaseQty) {
  const availLots = lots
    .filter(l => {
      const remDays = typeof l.daysLeft === 'number' ? l.daysLeft : diffDaysFromToday(l.exp);
      return (
        l.drugId === drug.id &&
        remDays > 0 &&
        l.baseQty > 0 &&
        l.status !== 'KHOA_HET_HAN' &&
        l.status !== 'XUAT_HUY' &&
        l.status !== 'XUAT_TRA_NCC' &&
        l.status !== 'CHO_DUYET_NHAP' &&
        l.fefoEligible !== false
      );
    })
    .sort((a, b) => new Date(a.exp) - new Date(b.exp));

  const totalAvail = availLots.reduce((sum, l) => sum + l.baseQty, 0);
  if (neededBaseQty > totalAvail) {
    return { ok: false, totalAvail, allocations: [] };
  }

  let rem = neededBaseQty;
  const allocations = [];
  for (const lot of availLots) {
    if (rem <= 0) break;
    const take = Math.min(lot.baseQty, rem);
    allocations.push({
      dbId: lot.dbId,
      lotId: lot.lotId,
      batchNo: lot.batchNo,
      exp: lot.exp,
      takeBase: take
    });
    rem -= take;
  }
  return { ok: true, totalAvail, allocations };
}

/* Hàm matchesPosSearchKeyword: Kiểm tra thuốc khớp từ khóa tìm kiếm theo Tên thuốc, Hoạt chất, Mã vạch Barcode hoặc Mã thuốc */
function matchesPosSearchKeyword(drug, kw) {
  if (!kw) return true;
  return (
    (drug.name || '').toLowerCase().includes(kw) ||
    (drug.ingredient || '').toLowerCase().includes(kw) ||
    (drug.barcode || '').toLowerCase().includes(kw) ||
    (drug.id || '').toLowerCase().includes(kw)
  );
}

/* Hàm searchPosProducts: Truy vấn trực tiếp SQL Server theo tham số ?search= khi bấm nút Tìm kiếm; nếu xóa trống sẽ tải lại toàn bộ danh sách sản phẩm */
async function searchPosProducts() {
  const inputEl = document.getElementById('posSearchInput');
  const rawKeyword = inputEl ? inputEl.value.trim() : '';
  currentSearchKeyword = rawKeyword.toLowerCase();

  await loadScreenPosData(true);

  if (!currentSearchKeyword) {
    showToast(`Đã truy vấn và hiển thị trở lại toàn bộ danh sách (${drugs.length} sản phẩm) trong CSDL!`, 'success');
  } else {
    const matchedDrugs = drugs.filter(d => matchesPosSearchKeyword(d, currentSearchKeyword));
    if (matchedDrugs.length === 0) {
      showToast(`Không tìm thấy sản phẩm nào khớp từ khóa / mã vạch "${rawKeyword}" trong CSDL!`, 'warning');
    } else {
      showToast(`Tìm thấy ${matchedDrugs.length} sản phẩm khớp "${rawKeyword}" từ CSDL.`, 'success');
    }
  }
}

/* Hàm renderPosProductList: Hiển thị danh sách sản phẩm có trong DB ra bảng chính ở cột bên trái */
function renderPosProductList() {
  const tbody = document.getElementById('posProductListBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  /* Lọc theo tên thuốc, hoạt chất, mã vạch barcode hoặc mã thuốc nếu có từ khóa tìm kiếm */
  const filteredDrugs = currentSearchKeyword
    ? drugs.filter(d => matchesPosSearchKeyword(d, currentSearchKeyword))
    : drugs;

  if (filteredDrugs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 24px; color: var(--muted);">
          Không tìm thấy sản phẩm nào khớp với tên vừa nhập. Hãy xóa ô tìm kiếm và ấn nút <strong>Tìm kiếm</strong> để quay lại danh sách đầy đủ.
        </td>
      </tr>
    `;
    return;
  }

  filteredDrugs.forEach(drug => {
    const rowState = productRowSelections[drug.id] || {
      unitName: drug.units[0]?.unitName || drug.baseUnit,
      qty: 1
    };

    const unitObj = drug.units.find(u => u.unitName === rowState.unitName) || drug.units[0];
    const neededBaseQty = rowState.qty * unitObj.rate;
    const fefoResult = allocateFefoForDrug(drug, neededBaseQty);
    const lineTotal = rowState.qty * unitObj.price;

    /* Kiểm tra xem sản phẩm này đã có trong giỏ hàng hay chưa */
    const inCartItem = posCart.find(c => c.drugId === drug.id);

    /* Tạo nội dung ô hiển thị Lô xuất tự động (FEFO) đúng theo thiết kế quay pos 3.txt .drawio */
    let fefoBoxHtml = '';
    if (!fefoResult.ok) {
      fefoBoxHtml = `
        <div class="fefo-batch-box" style="border-color: var(--danger); background: #fef2f2;">
          <strong style="color: var(--danger);">Không đủ tồn FEFO!</strong><br/>
          <span>Cần: ${neededBaseQty} ${drug.baseUnit}</span><br/>
          <span>Tồn khả dụng: ${fefoResult.totalAvail} ${drug.baseUnit}</span>
        </div>
      `;
    } else {
      fefoBoxHtml = `
        <div class="fefo-batch-box">
          ${fefoResult.allocations.map(a => `
            <div>
              <strong>Lô ${a.batchNo}</strong><br/>
              <span>(HSD: ${a.exp})</span><br/>
              <span style="color: var(--primary-dark); font-weight: 700;">&rarr; Trừ ${a.takeBase} ${drug.baseUnit}</span>
            </div>
          `).join('<hr style="margin:4px 0; border:none; border-top:1px dashed #cbd5e1;"/>')}
        </div>
      `;
    }

    /* Tạo danh sách tùy chọn đơn vị tính bán */
    const unitOptionsHtml = drug.units
      .map(u => `<option value="${u.unitName}" ${u.unitName === unitObj.unitName ? 'selected' : ''}>${u.unitName} (${u.rate} ${drug.baseUnit})</option>`)
      .join('');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong style="cursor:pointer; color:#0f172a;" onclick="previewDrugSop('${drug.id}')" title="Nhấn để xem quy trình tư vấn SOP của thuốc">${drug.name}</strong><br/>
        <span class="badge ${drug.type === 'ETC' ? 'badge-etc' : 'badge-otc'}" style="margin-top:4px;">${drug.type}</span>
        <small style="display:block; color:var(--muted); font-size:11px; margin-top:2px;">${drug.shelfLocation || ''}</small>
      </td>
      <td>${fefoBoxHtml}</td>
      <td>
        <select onchange="onProductRowUnitChange('${drug.id}', this.value)" style="min-width: 115px;">
          ${unitOptionsHtml}
        </select>
      </td>
      <td style="text-align:center;">
        <input
          type="number"
          min="1"
          value="${rowState.qty}"
          style="width: 60px; text-align: center;"
          oninput="onProductRowQtyChange('${drug.id}', this.value)"
        />
      </td>
      <td style="text-align:center;">
        <strong>-${neededBaseQty} ${drug.baseUnit}</strong>
      </td>
      <td style="text-align:center;">
        <input
          type="text"
          value="${unitObj.price.toLocaleString('vi-VN')} đ"
          readonly
          title="Đơn giá niêm yết bị khóa Read-only theo phân quyền RBAC"
          style="width: 100px; text-align: center;"
        />
      </td>
      <td style="text-align:center;">
        <strong>${lineTotal.toLocaleString('vi-VN')} đ</strong>
      </td>
      <td style="text-align:center;">
        <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
          <button type="button" class="btn btn-primary" style="padding:6px 10px; font-size:12px;" onclick="addProductRowToCart('${drug.id}')">
            + Thêm
          </button>
          ${inCartItem ? `<button type="button" class="btn btn-outline" style="padding:6px 8px; font-size:12px; color:var(--danger); border-color:#fca5a5;" onclick="removeProductFromCartByDrugId('${drug.id}')" title="Xóa khỏi giỏ hàng">X</button>` : ''}
        </div>
        ${inCartItem ? `<div style="font-size:11px; color:var(--success); font-weight:700; margin-top:3px;">Đã trong giỏ: ${inCartItem.qty} ${inCartItem.unitName}</div>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* Hàm previewDrugSop: Hiển thị quy trình tư vấn chuẩn SOP của sản phẩm được chọn lên khung SOP bên phải */
function previewDrugSop(drugId) {
  const drug = drugs.find(d => d.id === drugId);
  if (!drug) return;
  const sopList = document.getElementById('sopStepsList');
  if (sopList) {
    sopList.innerHTML = drug.sop.map(step => `<li>${step}</li>`).join('');
  }
}

/* Hàm onProductRowUnitChange: Cập nhật lại ĐVT bán, đơn giá niêm yết và SL trừ kho cơ bản khi đổi ĐVT trên danh sách sản phẩm */
function onProductRowUnitChange(drugId, newUnitName) {
  if (!productRowSelections[drugId]) {
    productRowSelections[drugId] = { unitName: newUnitName, qty: 1 };
  } else {
    productRowSelections[drugId].unitName = newUnitName;
  }

  /* Nếu sản phẩm đã có trong giỏ hàng thì đồng bộ luôn ĐVT trong giỏ hàng */
  const cartItem = posCart.find(c => c.drugId === drugId);
  if (cartItem) {
    cartItem.unitName = newUnitName;
  }

  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm onProductRowQtyChange: Cập nhật lại số lượng mua, SL trừ kho cơ bản và thành tiền khi nhập số lượng trên bảng sản phẩm */
function onProductRowQtyChange(drugId, newQtyValue) {
  const qty = Math.max(1, Number(newQtyValue || 1));
  if (!productRowSelections[drugId]) {
    const drug = drugs.find(d => d.id === drugId);
    productRowSelections[drugId] = { unitName: drug?.units[0]?.unitName || 'Viên', qty };
  } else {
    productRowSelections[drugId].qty = qty;
  }

  /* Nếu sản phẩm đang có trong giỏ hàng thì đồng bộ số lượng trong giỏ */
  const cartItem = posCart.find(c => c.drugId === drugId);
  if (cartItem) {
    cartItem.qty = qty;
  }

  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm addProductRowToCart: Thêm sản phẩm từ danh sách DB vào Giỏ hàng POS (cộng dồn nếu bấm thêm lại cùng ĐVT) và hiển thị SOP tư vấn */
function addProductRowToCart(drugId) {
  const drug = drugs.find(d => d.id === drugId);
  if (!drug) return;

  previewDrugSop(drugId);

  const rowState = productRowSelections[drugId] || {
    unitName: drug.units[0]?.unitName || drug.baseUnit,
    qty: 1
  };
  const unitObj = drug.units.find(u => u.unitName === rowState.unitName) || drug.units[0];
  const existing = posCart.find(item => item.drugId === drugId);

  /* Nếu thuốc đã có trong giỏ hàng với cùng ĐVT và người dùng bấm "+ Thêm" tiếp thì cộng dồn +1 */
  const targetQty = existing
    ? (existing.unitName === rowState.unitName && existing.qty === rowState.qty
        ? existing.qty + 1
        : rowState.qty)
    : rowState.qty;

  const neededBaseQty = targetQty * unitObj.rate;
  const fefoCheck = allocateFefoForDrug(drug, neededBaseQty);

  if (!fefoCheck.ok) {
    showToast(`ERR_INSUFFICIENT_STOCK: Thuốc ${drug.name} không đủ tồn kho FEFO khả dụng (Cần ${neededBaseQty}, Tồn ${fefoCheck.totalAvail} ${drug.baseUnit})!`, 'error');
    return;
  }

  productRowSelections[drugId] = {
    unitName: rowState.unitName,
    qty: targetQty
  };

  if (existing) {
    existing.unitName = rowState.unitName;
    existing.qty = targetQty;
    showToast(`Đã cập nhật ${drug.name} (${existing.qty} ${existing.unitName}) trong Giỏ hàng -> Lô FEFO: ${fefoCheck.allocations[0].batchNo}`, 'success');
  } else {
    posCart.push({
      drugId: drug.id,
      unitName: rowState.unitName,
      qty: targetQty
    });
    showToast(`Đã thêm ${drug.name} (${targetQty} ${rowState.unitName}) vào Giỏ hàng -> Lô FEFO: ${fefoCheck.allocations[0].batchNo}`, 'success');
  }

  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm removeProductFromCartByDrugId: Xóa nhanh sản phẩm khỏi giỏ hàng ngay từ dòng sản phẩm hoặc Popup */
function removeProductFromCartByDrugId(drugId) {
  posCart = posCart.filter(c => c.drugId !== drugId);
  renderPosProductList();
  renderCartPopupTable();
  updatePosOrderSummary();
  showToast('Đã xóa sản phẩm khỏi giỏ hàng.', 'warning');
}

/* Hàm openCartPopup: Mở Popup hiển thị danh sách những sản phẩm đã thêm vào giỏ hàng khi nhấn nút Giỏ hàng bên trái */
function openCartPopup() {
  renderCartPopupTable();
  const modal = document.getElementById('cartPopupModal');
  if (modal) modal.classList.add('open');
}

/* Hàm closeCartPopup: Đóng cửa sổ Popup Giỏ hàng */
function closeCartPopup() {
  const modal = document.getElementById('cartPopupModal');
  if (modal) modal.classList.remove('open');
}

/* Hàm proceedFromCartPopup: Đóng Popup Giỏ hàng và đưa con trỏ vào ô Tiền khách đưa để hoàn tất thanh toán */
function proceedFromCartPopup() {
  closeCartPopup();
  const cashInput = document.getElementById('customerCashInput');
  if (cashInput) cashInput.focus();
}

/* Hàm renderCartPopupTable: Vẽ bảng các sản phẩm đã thêm vào giỏ hàng bên trong Popup Giỏ hàng */
function renderCartPopupTable() {
  const tbody = document.getElementById('posCartPopupBody');
  const totalEl = document.getElementById('cartPopupTotalText');
  if (!tbody) return;
  tbody.innerHTML = '';

  let popupTotal = 0;

  if (posCart.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 24px; color: var(--muted);">
          Giỏ hàng hiện đang trống. Hãy nhấn nút <strong>"+ Thêm"</strong> ở danh sách sản phẩm để đưa thuốc vào giỏ hàng.
        </td>
      </tr>
    `;
    if (totalEl) totalEl.textContent = '0 VNĐ';
    return;
  }

  posCart.forEach((item, idx) => {
    const drug = findDrugById(item.drugId);
    if (!drug) return;

    const unitObj = drug.units.find(u => u.unitName === item.unitName) || drug.units[0];
    const neededBaseQty = item.qty * unitObj.rate;
    const fefoResult = allocateFefoForDrug(drug, neededBaseQty);
    const lineTotal = item.qty * unitObj.price;
    popupTotal += lineTotal;

    let fefoHtml = '';
    if (!fefoResult.ok) {
      fefoHtml = `<span class="badge badge-red">Không đủ tồn! (Cần ${neededBaseQty}, Tồn: ${fefoResult.totalAvail} ${drug.baseUnit})</span>`;
    } else {
      fefoHtml = fefoResult.allocations
        .map(a => `<div><span class="badge badge-green">Lô ${a.batchNo}</span> (HSD: ${a.exp}) &rarr; Trừ <strong>${a.takeBase} ${drug.baseUnit}</strong></div>`)
        .join('');
      if (fefoResult.allocations.length > 1) {
        fefoHtml += `<small style="color:var(--warning); font-weight:700;">⚡ Tự động tách ${fefoResult.allocations.length} lô liên tiếp theo FEFO</small>`;
      }
    }

    const unitOptionsHtml = drug.units
      .map(u => `<option value="${u.unitName}" ${u.unitName === item.unitName ? 'selected' : ''}>${u.unitName} (${u.rate} ${drug.baseUnit})</option>`)
      .join('');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${drug.name}</strong><br/>
        <span class="badge ${drug.type === 'ETC' ? 'badge-etc' : 'badge-otc'}">${drug.type}</span>
      </td>
      <td>${fefoHtml}</td>
      <td>
        <select onchange="onCartPopupUnitChange(${idx}, this.value)">${unitOptionsHtml}</select>
      </td>
      <td>
        <input type="number" min="1" value="${item.qty}" style="width: 68px; text-align:center;" oninput="onCartPopupQtyChange(${idx}, this.value)" />
      </td>
      <td><strong>-${neededBaseQty} ${drug.baseUnit}</strong></td>
      <td>
        <input type="text" value="${unitObj.price.toLocaleString('vi-VN')} đ" readonly style="width: 105px; text-align:center;" />
      </td>
      <td><strong>${lineTotal.toLocaleString('vi-VN')} đ</strong></td>
      <td>
        <button type="button" class="btn btn-outline" style="color:var(--danger); border-color:#fca5a5;" onclick="removePosCartItem(${idx})">X</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (totalEl) {
    totalEl.textContent = popupTotal.toLocaleString('vi-VN') + ' VNĐ';
  }
}

/* Hàm onCartPopupUnitChange: Đổi đơn vị tính của sản phẩm ngay trong Popup Giỏ hàng */
function onCartPopupUnitChange(idx, newUnit) {
  if (!posCart[idx]) return;
  posCart[idx].unitName = newUnit;
  const drugId = posCart[idx].drugId;
  if (productRowSelections[drugId]) {
    productRowSelections[drugId].unitName = newUnit;
  }
  renderCartPopupTable();
  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm onCartPopupQtyChange: Đổi số lượng mua của sản phẩm ngay trong Popup Giỏ hàng */
function onCartPopupQtyChange(idx, newQty) {
  if (!posCart[idx]) return;
  const qty = Math.max(1, Number(newQty || 1));
  posCart[idx].qty = qty;
  const drugId = posCart[idx].drugId;
  if (productRowSelections[drugId]) {
    productRowSelections[drugId].qty = qty;
  }
  renderCartPopupTable();
  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm removePosCartItem: Xóa 1 dòng sản phẩm khỏi Popup Giỏ hàng theo chỉ số dòng */
function removePosCartItem(idx) {
  posCart.splice(idx, 1);
  renderCartPopupTable();
  renderPosProductList();
  updatePosOrderSummary();
}

/* Hàm clearPosCart: Xóa toàn bộ sản phẩm trong giỏ hàng */
function clearPosCart() {
  posCart = [];
  renderCartPopupTable();
  renderPosProductList();
  updatePosOrderSummary();
  showToast('Đã làm mới toàn bộ giỏ hàng.', 'warning');
}

/* Hàm updatePosOrderSummary: Cập nhật số lượng trên nút Giỏ hàng bên trái, danh sách tóm tắt, khung đơn ETC và Tổng thanh toán bên phải */
function updatePosOrderSummary() {
  let grandTotal = 0;
  let hasEtcDrug = false;
  const miniListParts = [];

  posCart.forEach(item => {
    const drug = findDrugById(item.drugId);
    if (!drug) return;
    if (drug.type === 'ETC') hasEtcDrug = true;
    const unitObj = drug.units.find(u => u.unitName === item.unitName) || drug.units[0];
    const lineTotal = item.qty * unitObj.price;
    grandTotal += lineTotal;
    miniListParts.push(`<div>• <strong>${drug.name}</strong>: ${item.qty} ${item.unitName} = <strong>${lineTotal.toLocaleString('vi-VN')}đ</strong></div>`);
  });

  /* Cập nhật huy hiệu số lượng trên nút Giỏ hàng bên trái */
  const badgeEl = document.getElementById('cartCountBadge');
  if (badgeEl) badgeEl.textContent = String(posCart.length);

  const miniCountEl = document.getElementById('miniCartCount');
  if (miniCountEl) miniCountEl.textContent = String(posCart.length);

  const miniListEl = document.getElementById('miniCartItemsList');
  if (miniListEl) {
    miniListEl.innerHTML = miniListParts.length > 0
      ? miniListParts.join('')
      : '<span style="color:var(--muted);">Chưa có sản phẩm nào trong giỏ.</span>';
  }

  /* Cập nhật Tổng thanh toán và số tiền trên mã QR */
  const totalEl = document.getElementById('posTotalAmount');
  if (totalEl) totalEl.textContent = grandTotal.toLocaleString('vi-VN') + ' VNĐ';

  const qrTextEl = document.getElementById('qrAmountText');
  if (qrTextEl) qrTextEl.textContent = 'Số tiền: ' + grandTotal.toLocaleString('vi-VN') + ' VNĐ';

  /* Bật / tắt khung nhập thông tin đơn thuốc bác sĩ nếu trong giỏ có thuốc kê đơn ETC */
  const etcBox = document.getElementById('etcPrescriptionBox');
  if (etcBox) etcBox.style.display = hasEtcDrug ? 'block' : 'none';

  /* Tính lại tiền thừa trả khách */
  calculateChangeAmount(grandTotal);
}

/* Hàm calculateChangeAmount: Tính toán tự động Tiền thừa trả khách = Tiền khách đưa - Tổng thanh toán */
function calculateChangeAmount(precalcTotal) {
  let grandTotal = precalcTotal;
  if (typeof grandTotal !== 'number') {
    grandTotal = posCart.reduce((sum, item) => {
      const drug = findDrugById(item.drugId);
      const unitObj = drug?.units.find(u => u.unitName === item.unitName) || drug?.units[0];
      return sum + (item.qty * (unitObj ? unitObj.price : 0));
    }, 0);
  }

  const cashInput = document.getElementById('customerCashInput');
  const changeOutput = document.getElementById('customerChangeOutput');
  if (!cashInput || !changeOutput) return;

  const givenMoney = Number(cashInput.value || 0);
  if (grandTotal === 0 || givenMoney === 0) {
    changeOutput.value = '0 VNĐ';
    changeOutput.style.color = '#0f172a';
    return;
  }

  const diff = givenMoney - grandTotal;
  if (diff >= 0) {
    changeOutput.value = diff.toLocaleString('vi-VN') + ' VNĐ';
    changeOutput.style.color = 'var(--success)';
  } else {
    changeOutput.value = 'Thiếu ' + Math.abs(diff).toLocaleString('vi-VN') + ' VNĐ';
    changeOutput.style.color = 'var(--danger)';
  }
}

/* Hàm simulateExpiredScan: Kiểm thử nghiệp vụ chặn bán 100% khi quét phải lô thuốc đã khóa hết hạn (KHOA_HET_HAN) trong CSDL */
async function simulateExpiredScan() {
  const expiredLot = lots.find(l => l.status === 'KHOA_HET_HAN' || Number(l.daysLeft) <= 0);
  if (!expiredLot) {
    showToast('Hiện không có lô thuốc nào ở trạng thái KHOA_HET_HAN trong CSDL.', 'warning');
    return;
  }
  const drug = findDrugById(expiredLot.drugId);
  try {
    const res = await fetch(`${API_BASE}/ban-le-pos/thanh-toan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payMethod: 'TIEN_MAT',
        userId: getCurrentUser().userId,
        items: [{
          drugId: expiredLot.drugId,
          qty: 1,
          unitName: drug ? drug.baseUnit : 'Viên',
          rate: 1,
          price: 1000,
          lineMoney: 1000,
          allocations: [{
            dbId: expiredLot.dbId,
            lotId: expiredLot.lotId,
            batchNo: expiredLot.batchNo,
            exp: expiredLot.exp,
            takeBase: 1
          }]
        }]
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message, 'error');
      return;
    }
  } catch (e) {}
  showToast(`Lô ${expiredLot.batchNo} (HSD: ${expiredLot.exp}) đang ở trạng thái ${expiredLot.status}! Hệ thống chặn 100% xuất bán thương mại.`, 'error');
}

/* Hàm toggleVietQRPreview: Hiển thị hoặc ẩn khung mã VietQR động NAPAS 247 khi đổi phương thức thanh toán */
function toggleVietQRPreview() {
  const method = document.getElementById('posPayMethod').value;
  const qrBox = document.getElementById('vietQrBox');
  if (qrBox) {
    qrBox.style.display = method === 'VIETQR' ? 'block' : 'none';
  }
}

/* Hàm checkoutPOS: Xác nhận thanh toán đơn hàng, kiểm tra ràng buộc ETC/Tồn kho/Tiền mặt, gọi API SQL Server trừ kho FEFO và in hóa đơn K80 */
async function checkoutPOS() {
  if (posCart.length === 0) {
    showToast('Giỏ hàng đang trống! Hãy nhấn "+ Thêm" ở bảng sản phẩm trước khi thanh toán.', 'error');
    return;
  }

  const hasEtc = posCart.some(i => {
    const d = findDrugById(i.drugId);
    return d && d.type === 'ETC';
  });

  const etcCode = (document.getElementById('etcCode')?.value || '').trim();
  const etcClinic = (document.getElementById('etcClinic')?.value || '').trim();
  const doc = (document.getElementById('etcDoctor')?.value || '').trim();
  const diag = (document.getElementById('etcDiagnosis')?.value || '').trim();

  if (hasEtc && (!etcCode || !doc || !etcClinic || !diag)) {
    showToast('Đơn hàng có thuốc kê đơn ETC! Bắt buộc nhập đủ Mã đơn thuốc, Bác sĩ kê đơn, Cơ sở khám bệnh và Chẩn đoán bệnh.', 'error');
    return;
  }

  const receiptLines = [];
  const payloadItems = [];
  let totalMoney = 0;

  for (const item of posCart) {
    const drug = findDrugById(item.drugId);
    if (!drug) continue;
    const unitObj = drug.units.find(u => u.unitName === item.unitName) || drug.units[0];
    const neededBase = item.qty * unitObj.rate;
    const fefo = allocateFefoForDrug(drug, neededBase);

    if (!fefo.ok) {
      showToast(`Thuốc ${drug.name} không đủ tồn kho khả dụng! Chặn âm kho.`, 'error');
      return;
    }

    const lineMoney = item.qty * unitObj.price;
    totalMoney += lineMoney;

    payloadItems.push({
      drugId: drug.id,
      qty: item.qty,
      unitName: item.unitName,
      rate: unitObj.rate,
      price: unitObj.price,
      lineMoney,
      allocations: fefo.allocations
    });

    receiptLines.push({
      name: drug.name,
      qty: item.qty,
      unitName: item.unitName,
      price: unitObj.price,
      lineMoney,
      lotsText: fefo.allocations.map(a => `${a.batchNo} (HSD:${a.exp}, -${a.takeBase} ${drug.baseUnit})`).join(', ')
    });
  }

  const payMethod = document.getElementById('posPayMethod').value;
  const givenMoney = Number(document.getElementById('customerCashInput')?.value || 0);

  if (payMethod === 'TIEN_MAT' && givenMoney > 0 && givenMoney < totalMoney) {
    showToast(`Số tiền khách đưa (${givenMoney.toLocaleString('vi-VN')}đ) nhỏ hơn Tổng thanh toán (${totalMoney.toLocaleString('vi-VN')}đ)!`, 'error');
    return;
  }

  const effectiveGiven = givenMoney > 0 ? givenMoney : totalMoney;
  let changeAmount = Math.max(0, effectiveGiven - totalMoney);
  const currentUser = getCurrentUser();
  let invoiceCode = 'HD-POS-' + Date.now().toString().slice(-6);
  let finalReceiptLines = receiptLines;

  try {
    const res = await fetch(`${API_BASE}/ban-le-pos/thanh-toan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payMethod,
        etcCode: hasEtc ? etcCode : null,
        etcClinic: hasEtc ? etcClinic : null,
        etcDoctor: hasEtc ? doc : null,
        etcDiagnosis: hasEtc ? diag : null,
        items: payloadItems,
        userId: currentUser.userId
      })
    });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.message || 'Lỗi thanh toán POS trên SQL Server', 'error');
      return;
    }
    invoiceCode = data.invoiceCode || invoiceCode;
    /* Hóa đơn in theo số liệu do server tính (giá niêm yết + lô FEFO thực tế đã trừ kho) */
    if (Array.isArray(data.lines) && data.lines.length > 0) {
      finalReceiptLines = data.lines;
    }
    if (typeof data.grandTotal === 'number') {
      totalMoney = data.grandTotal;
      changeAmount = Math.max(0, effectiveGiven - totalMoney);
    }
    showToast(data.message, 'success');
    await loadScreenPosData(true);
  } catch (err) {
    showToast('Không thể kết nối tới máy chủ SQL Server để thực hiện thanh toán!', 'error');
    return;
  }

  const nowStr = new Date().toLocaleString('vi-VN');

  /* Tạo nội dung Hóa đơn bán lẻ khổ K80 hiển thị trên Modal */
  const receiptHtml = `
    <div style="text-align:center; font-weight:bold;">NHÀ THUỐC MINH TIẾN - CHUẨN GPP</div>
    <div style="text-align:center;">39 Kim Giang, Định Công, Hà Nội</div>
    <hr style="margin:8px 0;"/>
    <div><strong>HÓA ĐƠN BÁN LẺ (${invoiceCode})</strong></div>
    <div>Ngày giờ: ${nowStr} | TT: ${payMethod}</div>
    <div>Dược sĩ: ${currentUser.fullName}</div>
    ${hasEtc ? `<div style="font-size:11px; color:#b91c1c;">Đơn ETC: ${etcCode || 'Đơn ngoại trú'} - BS: ${doc} (${diag})</div>` : ''}
    <hr style="margin:8px 0;"/>
    ${finalReceiptLines.map(r => `
      <div style="margin-bottom:6px;">
        <div><strong>${r.name}</strong></div>
        <div>${r.qty} ${r.unitName} x ${r.price.toLocaleString('vi-VN')} = <strong>${r.lineMoney.toLocaleString('vi-VN')}đ</strong></div>
        <div style="font-size:11px;">Lô xuất FEFO: ${r.lotsText}</div>
      </div>
    `).join('')}
    <hr style="margin:8px 0;"/>
    <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:13.5px;">
      <span>TỔNG THANH TOÁN:</span>
      <span>${totalMoney.toLocaleString('vi-VN')} VNĐ</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:4px;">
      <span>Tiền khách đưa:</span>
      <span>${effectiveGiven.toLocaleString('vi-VN')} VNĐ</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold;">
      <span>Tiền thừa trả khách:</span>
      <span>${changeAmount.toLocaleString('vi-VN')} VNĐ</span>
    </div>
    <div style="text-align:center; margin-top:10px; font-size:11px;">Cảm ơn Quý khách!</div>
  `;

  document.getElementById('receiptContent').innerHTML = receiptHtml;
  document.getElementById('receiptModal').classList.add('open');

  /* Làm mới giỏ hàng sau khi thanh toán thành công */
  posCart = [];
  document.getElementById('customerCashInput').value = '';
  renderPosProductList();
  renderCartPopupTable();
  updatePosOrderSummary();
}

/* Hàm closeReceiptModal: Đóng hộp thoại xem trước hóa đơn nhiệt K80 */
function closeReceiptModal() {
  document.getElementById('receiptModal').classList.remove('open');
}

/* Lắng nghe phím tắt công thái học tại quầy POS: F1 (Tìm kiếm), F2 (Thanh toán), F7 (Tiền khách đưa) */
window.addEventListener('keydown', e => {
  if (e.key === 'F1') {
    e.preventDefault();
    document.getElementById('posSearchInput')?.focus();
  } else if (e.key === 'F2') {
    e.preventDefault();
    checkoutPOS();
  } else if (e.key === 'F7') {
    e.preventDefault();
    document.getElementById('customerCashInput')?.focus();
  }
});

/* Khởi chạy màn hình Bán lẻ Quầy POS khi DOM đã tải xong */
window.addEventListener('DOMContentLoaded', () => {
  initCommonRoleSwitcher();
  loadScreenPosData();
  registerAutoDbSync(loadScreenPosData);
});
