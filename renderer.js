// State
let currentUser = null;
let productsCache = [];

// DOM Elements
const views = {
  dashboard: document.getElementById('view-dashboard'),
  products: document.getElementById('view-products'),
  movements: document.getElementById('view-movements'),
  reports: document.getElementById('view-reports'),
  settings: document.getElementById('view-settings')
};

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
  // Check if session exists (simplified logic for desktop app)
  // For simplicity, we require login every restart
});

// --- Login Logic ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = document.getElementById('username').value;
  const p = document.getElementById('password').value;

  const result = await window.api.login(u, p);
  if (result.success) {
    currentUser = result.user;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('current-user-name').textContent = `المستخدم: ${currentUser.username}`;
    
    applyPermissions();
    loadView('dashboard');
  } else {
    showToast('خطأ في اسم المستخدم أو كلمة المرور', true);
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  window.location.reload();
});

// --- Navigation ---
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    loadView(item.dataset.view);
  });
});

function loadView(viewName) {
  // Hide all views
  Object.values(views).forEach(el => el.classList.add('hidden'));
  
  if(views[viewName]) {
    views[viewName].classList.remove('hidden');
    
    // Load data based on view
    if(viewName === 'dashboard') loadDashboard();
    if(viewName === 'products') loadProducts();
    if(viewName === 'movements') loadMovementForm();
    if(viewName === 'reports') loadReports();
  }
}

// --- Permissions ---
function applyPermissions() {
  const role = currentUser.role; // admin, employee, viewer
  const secureElements = document.querySelectorAll('[data-role]');
  
  secureElements.forEach(el => {
    const roles = el.dataset.role.split(',');
    if (!roles.includes(role)) {
      el.style.display = 'none';
    }
  });

  // If viewer, disable movement form
  if (role === 'viewer') {
    const movForm = document.getElementById('movement-form');
    if (movForm) {
      movForm.innerHTML = '<div style="text-align:center; color:red">ليس لديك صلاحية لإجراء حركات مخزنية</div>';
    }
  }
}

// --- Dashboard ---
async function loadDashboard() {
  const stats = await window.api.getStats();
  document.getElementById('stat-products').innerText = stats.productsCount;
  document.getElementById('stat-quantity').innerText = stats.totalQuantity;
  document.getElementById('stat-today').innerText = stats.todayMovements;

  const recent = await window.api.getRecentMovements();
  const tbody = document.querySelector('#recent-table tbody');
  tbody.innerHTML = '';
  recent.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.product_name || 'غير معروف'}</td>
      <td><span class="badge ${row.type === 'IN' ? 'badge-in' : 'badge-out'}">${row.type === 'IN' ? 'وارد' : 'منصرف'}</span></td>
      <td>${row.quantity}</td>
      <td>${new Date(row.created_at).toLocaleString('ar-EG')}</td>
      <td>${row.user_name}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- Products Management ---
async function loadProducts() {
  // Fetch ALL products for client-side filtering and suggestions
  productsCache = await window.api.getProducts('');
  
  // Populate suggestions
  const datalist = document.getElementById('product-suggestions');
  if (datalist) {
    datalist.innerHTML = '';
    productsCache.forEach(p => {
      const option = document.createElement('option');
      option.value = p.name;
      datalist.appendChild(option);
    });
  }

  // Initial Render
  filterAndRenderProducts();
}

function filterAndRenderProducts() {
  const search = document.getElementById('product-search').value.toLowerCase().trim();
  
  let filtered = productsCache;
  
  if (search) {
    filtered = productsCache.filter(p => {
      const name = p.name.toLowerCase();
      const code = p.code.toLowerCase();
      
      // 1. Direct match (Includes)
      if (name.includes(search) || code.includes(search)) return true;
      
      // 2. Fuzzy match (Sequence of characters)
      // Only for terms > 1 char to avoid too much noise
      if (search.length > 1) {
         let sIdx = 0;
         for (let char of name) {
           if (char === search[sIdx]) sIdx++;
           if (sIdx === search.length) return true;
         }
      }
      return false;
    });
  }

  renderProductsTable(filtered);
}

document.getElementById('product-search').addEventListener('input', () => {
  filterAndRenderProducts();
});

function renderProductsTable(products) {
  const tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';
  products.forEach(p => {
    const isLow = p.quantity <= p.min_limit;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td class="${isLow ? 'low-stock' : ''}">${p.quantity} ${isLow ? '⚠️' : ''}</td>
      <td>${p.min_limit}</td>
      <td>
        ${currentUser.role !== 'viewer' ? `
        <button class="action-btn btn-secondary" onclick="editProduct(${p.id})">تعديل</button>
        ${currentUser.role === 'admin' ? `<button class="action-btn btn-danger" onclick="deleteProduct(${p.id})">حذف</button>` : ''}
        ` : 'مشاهدة فقط'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Product Modal Logic
const modal = document.getElementById('product-modal');
const closeModal = document.querySelector('.close-modal');

document.getElementById('btn-add-product').addEventListener('click', () => {
  document.getElementById('product-form').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('modal-title').innerText = 'إضافة صنف جديد';
  
  // Auto generate code
  document.getElementById('prod-code').value = 'PROD-' + Math.floor(Math.random() * 10000);
  
  modal.style.display = 'flex';
});

closeModal.onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if(e.target == modal) modal.style.display = 'none'; }

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('prod-id').value;
  const data = {
    name: document.getElementById('prod-name').value,
    code: document.getElementById('prod-code').value,
    min_limit: document.getElementById('prod-min').value
  };

  try {
    if (id) {
      await window.api.updateProduct({ ...data, id });
      showToast('تم التعديل بنجاح');
    } else {
      await window.api.addProduct(data);
      showToast('تمت الإضافة بنجاح');
    }
    modal.style.display = 'none';
    loadProducts();
  } catch (err) {
    showToast('خطأ: ' + err.message, true);
  }
});

// Expose to window for onclick handlers
window.editProduct = (id) => {
  const p = productsCache.find(x => x.id == id);
  if (!p) return;
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-name').value = p.name;
  document.getElementById('prod-code').value = p.code;
  document.getElementById('prod-min').value = p.min_limit;
  document.getElementById('modal-title').innerText = 'تعديل صنف';
  modal.style.display = 'flex';
};

window.deleteProduct = async (id) => {
  if (confirm('هل أنت متأكد من حذف هذا الصنف؟')) {
    try {
      await window.api.deleteProduct(id);
      showToast('تم الحذف');
      loadProducts();
    } catch (err) {
      showToast('خطأ: ' + err.message, true); // Likely because of existing movements
    }
  }
};

// --- Inventory Movements ---
async function loadMovementForm() {
  const products = await window.api.getProducts('');
  const select = document.getElementById('mov-product');
  select.innerHTML = '';
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.text = `${p.name} (المتوفر: ${p.quantity})`;
    select.appendChild(opt);
  });
}

document.getElementById('movement-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    product_id: document.getElementById('mov-product').value,
    type: document.getElementById('mov-type').value,
    quantity: document.getElementById('mov-qty').value,
    reason: document.getElementById('mov-reason').value,
    user_id: currentUser.id
  };

  try {
    await window.api.addMovement(data);
    showToast('تم تسجيل الحركة بنجاح');
    document.getElementById('movement-form').reset();
    loadMovementForm(); // Refresh quantities in select
  } catch (err) {
    showToast('خطأ: ' + err.message, true);
  }
});

// --- Reports ---
async function loadReports() {
  const startDate = document.getElementById('report-start').value;
  const endDate = document.getElementById('report-end').value;
  
  const movements = await window.api.getAllMovements({ startDate, endDate });
  const tbody = document.querySelector('#report-table tbody');
  tbody.innerHTML = '';
  
  movements.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(row.created_at).toLocaleDateString('ar-EG')}</td>
      <td>${row.code}</td>
      <td>${row.product_name}</td>
      <td><span class="badge ${row.type === 'IN' ? 'badge-in' : 'badge-out'}">${row.type === 'IN' ? 'وارد' : 'منصرف'}</span></td>
      <td>${row.quantity}</td>
      <td>${row.reason || '-'}</td>
      <td>${row.username}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-filter-report').addEventListener('click', loadReports);

document.getElementById('btn-export-excel').addEventListener('click', async () => {
  const startDate = document.getElementById('report-start').value;
  const endDate = document.getElementById('report-end').value;
  const movements = await window.api.getAllMovements({ startDate, endDate });
  
  // Format data for excel
  const excelData = movements.map(m => ({
    "التاريخ": m.created_at,
    "كود الصنف": m.code,
    "اسم الصنف": m.product_name,
    "نوع الحركة": m.type === 'IN' ? 'وارد' : 'منصرف',
    "الكمية": m.quantity,
    "السبب": m.reason,
    "المستخدم": m.username
  }));

  const res = await window.api.exportToExcel({ data: excelData, filename: `report_${Date.now()}.xlsx` });
  if (res.success) showToast('تم التصدير بنجاح');
  else if (res.error) showToast('فشل التصدير', true);
});

// --- Settings / Backup ---
document.getElementById('btn-backup').addEventListener('click', async () => {
  const res = await window.api.backup();
  if (res.success) showToast('تم حفظ النسخة الاحتياطية');
  else if (res.error) showToast('فشل الحفظ: ' + res.error, true);
});

// --- Toast Notification ---
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? '#ef4444' : '#10b981';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}