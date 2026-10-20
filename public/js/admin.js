// Admin Panel Frontend Script

(function () {
  'use strict';

  let currentTab = 'tab-tasks';
  let departmentsCache = [];
  let taskPage = 1;
  const taskPageSize = 25;

  // Selected file for Excel import
  let selectedExcelFile = null;

  // Cache-busting photo URL generator
  function getPhotoUrl(photo, updatedAt) {
    if (!photo) return '';
    const v = updatedAt ? new Date(updatedAt).getTime() : Date.now();
    return `${photo}${photo.includes('?') ? '&' : '?'}v=${v}`;
  }

  // Init
  async function init() {
    await checkAdminAuth();
    setupTabs();
    setupExcelDropzone();
    await loadDepartmentsForSelect();
    await loadTasks();
    await loadDepartmentsList();
    await loadUsers();
    await loadSettings();
    await loadActiveDatasetInfo();
    bindEvents();
  }

  // Auth Check
  async function checkAdminAuth() {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) {
        window.location.href = '/login?redirect=/admin';
        return;
      }
      const data = await res.json();
      if (!data.user || data.user.role !== 'admin') {
        alert('Ruxsat berilmagan. Ushbu sahifa faqat administratorlar uchun.');
        window.location.href = '/dashboard';
      }
    } catch (err) {
      window.location.href = '/login?redirect=/admin';
    }
  }

  // Tabs Switcher
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const panel = document.getElementById(target);
        if (panel) panel.classList.add('active');
        currentTab = target;

        // Auto reload if switching
        if (target === 'tab-tasks') loadTasks();
        if (target === 'tab-excel') loadActiveDatasetInfo();
        if (target === 'tab-departments') loadDepartmentsList();
        if (target === 'tab-users') loadUsers();
        if (target === 'tab-settings') loadSettings();
      });
    });
  }

  // Toast Helper
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Modal Helpers
  window.openAdminModal = function (modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.add('active');
      document.body.style.overflow = 'hidden';
      const body = el.querySelector('.modal-body');
      if (body) body.scrollTop = 0;
    }
  };

  window.closeAdminModal = function (modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.remove('active');
      const anyActive = document.querySelector('.modal-overlay.active');
      if (!anyActive) {
        document.body.style.overflow = '';
      }
    }
  };

  // ==========================================
  // 1. TASKS MANAGEMENT
  // ==========================================

  const adminTasksTbody = document.getElementById('admin-tasks-tbody');
  const adminTaskSearch = document.getElementById('admin-task-search');
  const adminTaskStatusFilter = document.getElementById('admin-task-status-filter');
  const adminTaskDeptFilter = document.getElementById('admin-task-dept-filter');
  const adminTaskCountInfo = document.getElementById('admin-task-count-info');
  const adminTaskPrevBtn = document.getElementById('admin-task-prev-btn');
  const adminTaskNextBtn = document.getElementById('admin-task-next-btn');
  const adminTaskPageText = document.getElementById('admin-task-page-text');
  const addTaskBtn = document.getElementById('add-task-btn');
  const taskForm = document.getElementById('task-form');

  async function loadDepartmentsForSelect() {
    try {
      const res = await fetch(`/api/admin/departments?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        departmentsCache = await res.json();
        
        // Populate filter
        adminTaskDeptFilter.innerHTML = '<option value="all">Barcha boshqarmalar</option>' +
          departmentsCache.map(d => `<option value="${d.id}">[ID: #${d.leaderId}] ${d.name}</option>`).join('');

        // Populate form dept select
        const formDept = document.getElementById('form-task-dept');
        if (formDept) {
          formDept.innerHTML = departmentsCache.map(d => `<option value="${d.id}">[ID: #${d.leaderId}] ${d.name} (${d.headName})</option>`).join('');
        }
      }
    } catch (err) {
      console.error('Error loading depts:', err);
    }
  }

  async function loadTasks() {
    adminTasksTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #64748b;">Topshiriqlar yuklanmoqda...</td></tr>`;

    try {
      const params = new URLSearchParams({
        page: taskPage,
        pageSize: taskPageSize,
        search: adminTaskSearch.value.trim(),
        status: adminTaskStatusFilter.value,
        departmentId: adminTaskDeptFilter.value,
        _t: Date.now()
      });

      const res = await fetch(`/api/admin/tasks?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Topshiriqlarni yuklashda xatolik');
      const data = await res.json();

      adminTaskCountInfo.textContent = `Jami ${data.total} ta topshiriq (Ko‘rsatilmoqda: ${data.items.length} ta)`;
      adminTaskPageText.textContent = `${data.page} / ${data.totalPages}`;
      adminTaskPrevBtn.disabled = data.page <= 1;
      adminTaskNextBtn.disabled = data.page >= data.totalPages;

      if (data.items.length === 0) {
        adminTasksTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 32px; color: #64748b;">Topshiriqlar topilmadi.</td></tr>`;
        return;
      }

      adminTasksTbody.innerHTML = data.items.map((t, idx) => {
        const rowNum = (data.page - 1) * taskPageSize + (idx + 1);

        let statusBadge = '';
        if (t.computedStatus === 'overdue') {
          const delayText = t.delayDays > 0 ? ` (${t.delayDays} kun kechikkan)` : '';
          statusBadge = `<span class="status-badge overdue">Muddati o‘tgan${delayText}</span>`;
        } else if (t.computedStatus === 'completed') {
          statusBadge = `<span class="status-badge completed">Bajarilgan</span>`;
        } else {
          statusBadge = `<span class="status-badge in_progress">Bajarish jarayonida</span>`;
        }

        const matchedDept = departmentsCache.find(d => d.id === t.departmentId);
        const leaderIdDisplay = t.leaderId || (matchedDept ? matchedDept.leaderId : '');

        return `
          <tr>
            <td style="font-weight: 700; color: #64748b;">${rowNum}</td>
            <td>
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">${t.title}</div>
              <div style="font-size: 11.5px; color: #94a3b8;">${t.docType || 'Hujjat'} • ${t.taskNumber || ''}</div>
            </td>
            <td style="font-size: 13px; color: #334155;">
              ${leaderIdDisplay ? `<span style="display: inline-block; background: #0f172a; color: #38bdf8; font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 6px; font-family: monospace; margin-right: 6px;">#${leaderIdDisplay}</span>` : ''}
              ${t.departmentName}
            </td>
            <td style="font-size: 13px; font-weight: 600; color: #1e293b;">${t.responsiblePerson}</td>
            <td style="font-size: 13px; font-weight: 600; color: ${t.computedStatus === 'overdue' ? '#dc2626' : '#2563eb'};">
              ${t.deadline || '-'}
            </td>
            <td>${statusBadge}</td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                <button class="btn btn-secondary edit-task-btn" data-id="${t.id}" style="padding: 5px 10px; font-size: 12px;">Tahrirlash</button>
                <button class="btn btn-danger delete-task-btn" data-id="${t.id}" style="padding: 5px 10px; font-size: 12px;">O‘chirish</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Attach edit & delete handlers
      document.querySelectorAll('.edit-task-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditTaskModal(btn.getAttribute('data-id')));
      });

      document.querySelectorAll('.delete-task-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteTask(btn.getAttribute('data-id')));
      });

    } catch (err) {
      adminTasksTbody.innerHTML = `<tr><td colspan="7" style="color: #dc2626; text-align: center; padding: 24px;">Xatolik: ${err.message}</td></tr>`;
    }
  }

  function openAddTaskModal() {
    document.getElementById('task-modal-heading').textContent = 'Yangi topshiriq qo‘shish';
    document.getElementById('task-id').value = '';
    taskForm.reset();
    document.getElementById('form-task-deadline').value = new Date().toISOString().split('T')[0];
    openAdminModal('task-form-modal');
  }

  async function openEditTaskModal(taskId) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Topshiriq topilmadi');
      const t = await res.json();

      document.getElementById('task-modal-heading').textContent = 'Topshiriqni tahrirlash';
      document.getElementById('task-id').value = t.id;
      document.getElementById('form-task-number').value = t.taskNumber || '';
      document.getElementById('form-doc-type').value = t.docType || '';
      document.getElementById('form-task-title').value = t.title || '';
      document.getElementById('form-task-dept').value = t.departmentId || '';
      document.getElementById('form-task-resp').value = t.responsiblePerson || '';
      document.getElementById('form-task-deadline').value = t.deadline ? t.deadline.split('T')[0] : '';
      document.getElementById('form-task-status').value = t.status || 'in_progress';
      document.getElementById('form-task-notes').value = t.notes || '';

      openAdminModal('task-form-modal');
    } catch (err) {
      showToast('Topshiriq ma’lumotini olishda xatolik: ' + err.message, 'error');
    }
  }

  async function saveTask(e) {
    e.preventDefault();
    const taskId = document.getElementById('task-id').value;
    const body = {
      taskNumber: document.getElementById('form-task-number').value.trim(),
      docType: document.getElementById('form-doc-type').value.trim(),
      title: document.getElementById('form-task-title').value.trim(),
      departmentId: document.getElementById('form-task-dept').value,
      responsiblePerson: document.getElementById('form-task-resp').value.trim(),
      deadline: document.getElementById('form-task-deadline').value,
      status: document.getElementById('form-task-status').value,
      notes: document.getElementById('form-task-notes').value.trim()
    };

    try {
      const url = taskId ? `/api/admin/tasks/${taskId}` : '/api/admin/tasks';
      const method = taskId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');

      showToast(data.message || 'Muvaffaqiyatli saqlandi', 'success');
      closeAdminModal('task-form-modal');
      await loadTasks();
      notifyDashboardUpdate();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteTask(taskId) {
    if (!confirm('Haqiqatan ham ushbu topshiriqni o‘chirmoqchimisiz?')) return;
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'O‘chirishda xatolik');
      showToast(data.message || 'Topshiriq o‘chirildi', 'success');
      await loadTasks();
      await loadDepartmentsList();
      notifyDashboardUpdate();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Notify Dashboard (all open tabs, windows and devices) to immediately sync to Page 1
  function notifyDashboardUpdate() {
    try {
      localStorage.setItem('ijro_data_sync_time', Date.now().toString());
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('ijro_monitoring_channel');
        bc.postMessage({ type: 'DATA_UPDATED', timestamp: Date.now() });
        setTimeout(() => bc.close(), 100);
      }
    } catch (_) {}
  }

  // Clear all tasks completely
  async function clearAllTasks() {
    if (!confirm('DIQQAT! Haqiqatan ham bazadagi barcha topshiriqlarni butunlay o‘chirib tozalashni xohlaysizmi?\n\nUshbu amal barcha eski topshiriqlar va hisobotlarni 0 ga tushiradi.')) {
      return;
    }
    try {
      const res = await fetch('/api/admin/tasks/clear-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tozalashda xatolik');
      showToast(data.message || 'Barcha topshiriqlar tozalandi', 'success');
      taskPage = 1;
      await loadTasks();
      await loadDepartmentsForSelect();
      await loadDepartmentsList();
      notifyDashboardUpdate();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // 2. EXCEL IMPORT
  // ==========================================

  function setupExcelDropzone() {
    const dropzone = document.getElementById('excel-dropzone');
    const fileInput = document.getElementById('excel-file-input');
    const startImportBtn = document.getElementById('start-import-btn');
    const importStatusBox = document.getElementById('import-status-box');
    const clearExcelTabBtn = document.getElementById('clear-tasks-from-excel-tab-btn');
    const clearAllTasksBtn = document.getElementById('clear-all-tasks-btn');

    if (clearExcelTabBtn) {
      clearExcelTabBtn.addEventListener('click', clearAllTasks);
    }
    if (clearAllTasksBtn) {
      clearAllTasksBtn.addEventListener('click', clearAllTasks);
    }

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleExcelFileSelected(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleExcelFileSelected(fileInput.files[0]);
      }
    });

    function handleExcelFileSelected(file) {
      if (!file.name.match(/\.(xlsx|xls)$/i)) {
        showToast('Faqat Excel fayllari (.xlsx, .xls) qabul qilinadi', 'error');
        return;
      }
      selectedExcelFile = file;
      dropzone.innerHTML = `
        <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <div style="font-size: 15px; font-weight: 700; color: #0f172a;">${file.name}</div>
        <div style="font-size: 12.5px; color: #10b981; margin-top: 4px;">Fayl yuklashga tayyor (${Math.round(file.size / 1024)} KB)</div>
      `;
      startImportBtn.disabled = false;
    }

    startImportBtn.addEventListener('click', async () => {
      if (!selectedExcelFile) return;

      const mode = 'replace';
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('file', selectedExcelFile);

      startImportBtn.disabled = true;
      startImportBtn.textContent = 'Import qilinmoqda...';
      importStatusBox.style.display = 'block';
      importStatusBox.style.background = '#eff6ff';
      importStatusBox.style.border = '1px solid #bfdbfe';
      importStatusBox.style.color = '#1e40af';
      importStatusBox.innerHTML = 'Fayl serverga yuborilmoqda va topshiriqlar tahlil qilinmoqda...';

      try {
        const res = await fetch(`/api/admin/tasks/import-excel?mode=${encodeURIComponent(mode)}&_t=${Date.now()}`, {
          method: 'POST',
          body: formData
        });

        let data;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          const rawText = await res.text();
          throw new Error(rawText.startsWith('<') ? `Server xatosi (${res.status}): Faylni qabul qilib bo'lmadi.` : rawText);
        }

        if (!res.ok) throw new Error(data.error || 'Importda xatolik yuz berdi');

        importStatusBox.style.background = '#ecfdf5';
        importStatusBox.style.border = '1px solid #a7f3d0';
        importStatusBox.style.color = '#065f46';
        importStatusBox.innerHTML = `
          <strong>✅ Muvaffaqiyatli import qilindi!</strong><br>
          • Yangi yuklangan topshiriqlar: <strong>${data.importedCount} ta</strong> (Jami bazada: <strong>${data.totalTasks} ta</strong>)<br>
          • Muddati o‘tgan topshiriqlar: <strong style="color: #dc2626;">${data.overdueTasks || 0} ta</strong><br>
          • Bajarish jarayonida: <strong style="color: #2563eb;">${data.inProgressTasks || 0} ta</strong><br>
          <span style="font-size: 12px; color: #047857; font-weight: 600;">✨ Barcha eski topshiriqlar va ularning hisoboti to‘liq tozalandi. Dashboard faqat ushbu yangi fayl hisobotini aks ettiradi.</span>
        `;

        showToast(data.message, 'success');
        taskPage = 1;
        await loadDepartmentsForSelect();
        await loadTasks();
        await loadDepartmentsList();
        await loadActiveDatasetInfo();
        notifyDashboardUpdate();

      } catch (err) {
        importStatusBox.style.background = '#fef2f2';
        importStatusBox.style.border = '1px solid #fee2e2';
        importStatusBox.style.color = '#dc2626';
        importStatusBox.innerHTML = `❌ Xatolik: ${err.message}`;
        showToast(err.message, 'error');
      } finally {
        startImportBtn.disabled = false;
        startImportBtn.textContent = 'Excel faylini yuklash va import qilish';
      }
    });
  }

  async function loadActiveDatasetInfo() {
    try {
      const res = await fetch('/api/admin/imports', { cache: 'no-store' });
      if (!res.ok) return;
      const history = await res.json();
      const badge = document.getElementById('active-dataset-version-badge');
      const filenameEl = document.getElementById('active-dataset-filename');
      const timeEl = document.getElementById('active-dataset-time');
      const userEl = document.getElementById('active-dataset-user');
      const rowsEl = document.getElementById('active-dataset-rows');

      if (!history || history.length === 0) {
        if (badge) badge.textContent = 'Bazada ma’lumot yo‘q';
        if (filenameEl) filenameEl.textContent = 'Mavjud emas';
        if (timeEl) timeEl.textContent = '-';
        if (userEl) userEl.textContent = '-';
        if (rowsEl) rowsEl.textContent = '0 ta';
        return;
      }

      const latest = history[0];
      if (badge) badge.textContent = `Versiya #${latest.version || 1}`;
      if (filenameEl) filenameEl.textContent = latest.filename || '-';
      if (timeEl) timeEl.textContent = latest.importedAt ? new Date(latest.importedAt).toLocaleString('uz-UZ') : '-';
      if (userEl) userEl.textContent = latest.importedBy || 'Administrator';
      if (rowsEl) rowsEl.textContent = `${latest.rowCount || 0} ta topshiriq`;
    } catch (err) {
      console.warn('Error loading active dataset info:', err.message);
    }
  }

  // ==========================================
  // 3. DEPARTMENTS & HEADS MANAGEMENT
  // ==========================================

  const adminDeptListContainer = document.getElementById('admin-dept-list-container');
  const addDeptBtn = document.getElementById('add-dept-btn');
  const deptForm = document.getElementById('dept-form');

  async function loadDepartmentsList() {
    try {
      const res = await fetch(`/api/admin/departments?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Boshqarmalar olinmadi');
      const depts = await res.json();
      departmentsCache = depts;

      if (depts.length === 0) {
        adminDeptListContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #64748b; padding: 40px;">Boshqarmalar mavjud emas.</div>';
        return;
      }

      adminDeptListContainer.innerHTML = depts.map(d => {
        const initials = d.headName ? d.headName.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() : 'B';
        const photoUrl = getPhotoUrl(d.photo, d.updatedAt);
        const photoHtml = d.photo
          ? `<img src="${photoUrl}" alt="${d.headName}" style="width: 64px; height: 64px; border-radius: 14px; object-fit: cover;">`
          : `<div style="width: 64px; height: 64px; border-radius: 14px; background: #e2e8f0; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #475569; font-size: 18px;">${initials}</div>`;

        return `
          <div class="admin-dept-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 10px;">
                <div style="display: flex; gap: 14px; align-items: center; min-width: 0;">
                  ${photoHtml}
                  <div style="flex: 1; min-width: 0;">
                    <h3 style="font-size: 14px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${d.headName}</h3>
                    <p style="font-size: 12px; color: #64748b;">${d.headTitle || 'Mas’ul rahbar'}</p>
                  </div>
                </div>
                <span style="background: #0f172a; color: #38bdf8; font-weight: 800; font-size: 12px; padding: 4px 9px; border-radius: 8px; font-family: monospace; letter-spacing: 0.5px; border: 1px solid #334155; flex-shrink: 0;" title="Rahbar ID raqami">ID: #${d.leaderId || '-'}</span>
              </div>

              <div style="font-size: 12.5px; font-weight: 600; color: #1e293b; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; margin-bottom: 14px; line-height: 1.35;">
                🏢 ${d.name}
              </div>

              <div style="display: flex; gap: 8px; font-size: 12px;">
                <span class="status-badge overdue">Muddati o‘tgan: <strong>${d.overdueCount} ta</strong></span>
                <span class="status-badge in_progress">Jami: <strong>${d.totalTasks} ta</strong></span>
              </div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
              <button class="btn btn-secondary edit-dept-btn" data-id="${d.id}" style="padding: 5px 12px; font-size: 12px;">Tahrirlash / Rasm</button>
              <button class="btn btn-danger delete-dept-btn" data-id="${d.id}" style="padding: 5px 12px; font-size: 12px;">O‘chirish</button>
            </div>
          </div>
        `;
      }).join('');

      // Attach department listeners
      document.querySelectorAll('.edit-dept-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditDeptModal(btn.getAttribute('data-id')));
      });

      document.querySelectorAll('.delete-dept-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteDepartment(btn.getAttribute('data-id')));
      });

    } catch (err) {
      adminDeptListContainer.innerHTML = `<div style="color: #dc2626; padding: 24px;">Xatolik: ${err.message}</div>`;
    }
  }

  function setupDeptPhotoInput(onReset = null) {
    const photoInput = document.getElementById('form-dept-photo');
    const preview = document.getElementById('dept-photo-preview');
    if (!photoInput) return;

    photoInput.onchange = () => {
      if (photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        document.getElementById('form-dept-delete-photo').value = 'false';
        const objectUrl = URL.createObjectURL(file);
        preview.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 14px; padding: 12px 14px; margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
              <img src="${objectUrl}" alt="Yangi rasm" style="width: 58px; height: 58px; border-radius: 12px; object-fit: cover; border: 2px solid #22c55e; flex-shrink: 0;">
              <div style="min-width: 0;">
                <div style="font-size: 13px; font-weight: 700; color: #15803d;">Yangi fotosurat tanlandi!</div>
                <div style="font-size: 11.5px; color: #166534; word-break: break-all;">${file.name} (${Math.round(file.size / 1024)} KB)</div>
                <div style="font-size: 11px; color: #64748b; margin-top: 2px;">«Saqlash» tugmasini bosganingizda rasm yangilanadi</div>
              </div>
            </div>
            <button type="button" class="btn btn-secondary" id="reset-new-photo-btn" style="padding: 5px 10px; font-size: 11.5px; flex-shrink: 0;">Bekor qilish</button>
          </div>
        `;
        const resetBtn = document.getElementById('reset-new-photo-btn');
        if (resetBtn) {
          resetBtn.addEventListener('click', () => {
            photoInput.value = '';
            if (typeof onReset === 'function') onReset();
            else preview.innerHTML = '';
          });
        }
      }
    };
  }

  async function openAddDeptModal() {
    document.getElementById('dept-modal-heading').textContent = 'Yangi boshqarma va rahbar qo‘shish';
    document.getElementById('dept-id').value = '';
    deptForm.reset();
    document.getElementById('form-dept-delete-photo').value = 'false';
    document.getElementById('dept-photo-preview').innerHTML = '';
    const tag = document.getElementById('auto-id-tag');
    if (tag) tag.textContent = 'Avtomatik berildi';

    setupDeptPhotoInput();

    // Fetch automatic next ID
    try {
      const res = await fetch('/api/admin/departments/next-id', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        document.getElementById('form-dept-leader-id').value = data.nextId || '';
      }
    } catch (_) {}

    openAdminModal('dept-form-modal');
  }

  function openEditDeptModal(deptId) {
    const dept = departmentsCache.find(d => d.id === deptId);
    if (!dept) return;

    document.getElementById('dept-modal-heading').textContent = 'Boshqarma va rahbarni tahrirlash';
    document.getElementById('dept-id').value = dept.id;
    document.getElementById('form-dept-leader-id').value = dept.leaderId || '';
    const tag = document.getElementById('auto-id-tag');
    if (tag) tag.textContent = 'O‘zgartirish mumkin';
    document.getElementById('form-dept-name').value = dept.name;
    document.getElementById('form-dept-head').value = dept.headName;
    document.getElementById('form-dept-title').value = dept.headTitle || 'Mas’ul rahbar';
    document.getElementById('form-dept-photo').value = '';
    document.getElementById('form-dept-delete-photo').value = 'false';

    const preview = document.getElementById('dept-photo-preview');

    function renderCurrentPhotoPreview() {
      if (dept.photo) {
        const photoUrl = getPhotoUrl(dept.photo, dept.updatedAt);
        preview.innerHTML = `
          <div id="dept-photo-active-box" style="display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; margin-top: 6px;">
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
              <img src="${photoUrl}" alt="${dept.headName}" style="width: 58px; height: 58px; border-radius: 12px; object-fit: cover; border: 1.5px solid #cbd5e1; box-shadow: 0 2px 6px rgba(0,0,0,0.06); flex-shrink: 0;">
              <div style="min-width: 0;">
                <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Joriy fotosurat mavjud</div>
                <div style="font-size: 11.5px; color: #64748b;">O‘chirish yoki yangi rasm yuklash mumkin</div>
              </div>
            </div>
            <button type="button" class="btn btn-danger" id="delete-dept-photo-btn" style="padding: 6px 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              <span>Rasmni o‘chirish</span>
            </button>
          </div>
        `;

        const delBtn = document.getElementById('delete-dept-photo-btn');
        if (delBtn) {
          delBtn.addEventListener('click', () => {
            document.getElementById('form-dept-delete-photo').value = 'true';
            document.getElementById('form-dept-photo').value = '';
            preview.innerHTML = `
              <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 14px; padding: 13px 15px; margin-top: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 22px;">🗑️</span>
                    <div>
                      <div style="font-size: 13px; font-weight: 700; color: #dc2626;">Eski fotosurat o‘chirildi!</div>
                      <div style="font-size: 11.5px; color: #7f1d1d;">Barcha ma’lumotlarni bazada saqlash uchun «Saqlash» tugmasini bosing:</div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <button type="button" class="btn btn-secondary" id="cancel-delete-photo-btn" style="padding: 6px 12px; font-size: 12px;">
                      Qaytarish
                    </button>
                    <button type="button" class="btn btn-primary" id="instant-save-photo-btn" style="padding: 6px 16px; font-size: 12.5px; font-weight: 700; background: #16a34a; border-color: #15803d; color: #ffffff; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(22, 163, 74, 0.25);">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Saqlash</span>
                    </button>
                  </div>
                </div>
              </div>
            `;

            const cancelBtn = document.getElementById('cancel-delete-photo-btn');
            if (cancelBtn) {
              cancelBtn.addEventListener('click', () => {
                document.getElementById('form-dept-delete-photo').value = 'false';
                renderCurrentPhotoPreview();
              });
            }

            const saveBtn = document.getElementById('instant-save-photo-btn');
            if (saveBtn) {
              saveBtn.addEventListener('click', () => {
                deptForm.requestSubmit();
              });
            }
          });
        }
      } else {
        preview.innerHTML = '<div style="font-size: 12px; color: #94a3b8; padding: 8px 0;">Hozircha fotosurat yuklanmagan</div>';
      }
    }

    renderCurrentPhotoPreview();
    setupDeptPhotoInput(() => renderCurrentPhotoPreview());

    openAdminModal('dept-form-modal');
  }

  async function saveDepartment(e) {
    if (e && e.preventDefault) e.preventDefault();
    const deptId = document.getElementById('dept-id').value;
    const formData = new FormData();
    formData.append('leaderId', document.getElementById('form-dept-leader-id').value.trim());
    formData.append('name', document.getElementById('form-dept-name').value.trim());
    formData.append('headName', document.getElementById('form-dept-head').value.trim());
    formData.append('headTitle', document.getElementById('form-dept-title').value.trim());
    formData.append('deletePhoto', document.getElementById('form-dept-delete-photo').value);

    const photoFile = document.getElementById('form-dept-photo').files[0];
    if (photoFile) {
      formData.append('photo', photoFile);
    }

    try {
      const url = deptId ? `/api/admin/departments/${deptId}` : '/api/admin/departments';
      const method = deptId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Saqlashda xatolik');

      showToast(data.message || 'Boshqarma saqlandi', 'success');
      closeAdminModal('dept-form-modal');
      await loadDepartmentsForSelect();
      await loadDepartmentsList();
      notifyDashboardUpdate();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteDepartment(deptId) {
    if (!confirm('Haqiqatan ham ushbu boshqarmani o‘chirmoqchimisiz?')) return;
    try {
      const res = await fetch(`/api/admin/departments/${deptId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'O‘chirishda xatolik');

      showToast(data.message || 'Boshqarma o‘chirildi', 'success');
      await loadDepartmentsForSelect();
      await loadDepartmentsList();
      notifyDashboardUpdate();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // 4. USERS MANAGEMENT
  // ==========================================

  const adminUsersTbody = document.getElementById('admin-users-tbody');
  const addUserBtn = document.getElementById('add-user-btn');
  const userForm = document.getElementById('user-form');
  let usersCache = [];

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!res.ok) throw new Error('Foydalanuvchilar olinmadi');
      usersCache = await res.json();

      adminUsersTbody.innerHTML = usersCache.map(u => {
        return `
          <tr>
            <td style="font-weight: 700; color: #0f172a;">${u.username}</td>
            <td>${u.fullName}</td>
            <td>
              <span class="status-badge ${u.role === 'admin' ? 'overdue' : 'in_progress'}">
                ${u.role === 'admin' ? 'Administrator' : 'Kuzatuvchi'}
              </span>
            </td>
            <td style="font-size: 12.5px; color: #64748b;">${new Date(u.createdAt).toLocaleDateString('uz-UZ')}</td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                <button class="btn btn-secondary edit-user-btn" data-id="${u.id}" style="padding: 5px 10px; font-size: 12px;">Tahrirlash</button>
                <button class="btn btn-danger delete-user-btn" data-id="${u.id}" style="padding: 5px 10px; font-size: 12px;">O‘chirish</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      document.querySelectorAll('.edit-user-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditUserModal(btn.getAttribute('data-id')));
      });

      document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(btn.getAttribute('data-id')));
      });

    } catch (err) {
      adminUsersTbody.innerHTML = `<tr><td colspan="5" style="color: #dc2626; text-align: center; padding: 24px;">Xatolik: ${err.message}</td></tr>`;
    }
  }

  function openAddUserModal() {
    document.getElementById('user-modal-heading').textContent = 'Yangi foydalanuvchi';
    document.getElementById('user-id').value = '';
    userForm.reset();
    document.getElementById('form-user-password').required = true;
    document.getElementById('pwd-help-text').style.display = 'none';
    openAdminModal('user-form-modal');
  }

  function openEditUserModal(userId) {
    const u = usersCache.find(x => x.id === userId);
    if (!u) return;

    document.getElementById('user-modal-heading').textContent = 'Foydalanuvchini tahrirlash';
    document.getElementById('user-id').value = u.id;
    document.getElementById('form-user-username').value = u.username;
    document.getElementById('form-user-fullname').value = u.fullName;
    document.getElementById('form-user-role').value = u.role;
    document.getElementById('form-user-password').value = '';
    document.getElementById('form-user-password').required = false;
    document.getElementById('pwd-help-text').style.display = 'inline';

    openAdminModal('user-form-modal');
  }

  async function saveUser(e) {
    e.preventDefault();
    const userId = document.getElementById('user-id').value;
    const body = {
      username: document.getElementById('form-user-username').value.trim(),
      fullName: document.getElementById('form-user-fullname').value.trim(),
      role: document.getElementById('form-user-role').value
    };

    const pwd = document.getElementById('form-user-password').value.trim();
    if (pwd) body.password = pwd;

    try {
      const url = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
      const method = userId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Saqlashda xatolik');

      showToast(data.message || 'Foydalanuvchi saqlandi', 'success');
      closeAdminModal('user-form-modal');
      await loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteUser(userId) {
    if (!confirm('Haqiqatan ham ushbu foydalanuvchini o‘chirmoqchimisiz?')) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'O‘chirishda xatolik');

      showToast(data.message || 'Foydalanuvchi o‘chirildi', 'success');
      await loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================
  // 5. SETTINGS MANAGEMENT
  // ==========================================

  const settingsForm = document.getElementById('settings-form');
  const settingOrgName = document.getElementById('setting-org-name');
  const settingSubOrgName = document.getElementById('setting-sub-org-name');
  const settingSystemTitle = document.getElementById('setting-system-title');

  async function loadSettings() {
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      if (res.ok) {
        const s = await res.json();
        settingOrgName.value = s.orgName || '';
        settingSubOrgName.value = s.subOrgName || '';
        settingSystemTitle.value = s.systemTitle || '';
        document.getElementById('admin-org-subtitle').textContent = s.subOrgName || 'Ijro intizomi monitoring va nazorat tizimi';
      }
    } catch (err) {
      console.error('Settings load error:', err);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgName: settingOrgName.value.trim(),
          subOrgName: settingSubOrgName.value.trim(),
          systemTitle: settingSystemTitle.value.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Saqlashda xatolik');

      showToast(data.message || 'Sozlamalar muvaffaqiyatli saqlandi', 'success');
      document.getElementById('admin-org-subtitle').textContent = settingSubOrgName.value;
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Bind Events
  function bindEvents() {
    addTaskBtn.addEventListener('click', openAddTaskModal);
    taskForm.addEventListener('submit', saveTask);

    addDeptBtn.addEventListener('click', openAddDeptModal);
    deptForm.addEventListener('submit', saveDepartment);

    addUserBtn.addEventListener('click', openAddUserModal);
    userForm.addEventListener('submit', saveUser);

    settingsForm.addEventListener('submit', saveSettings);

    // Filters for tasks
    let searchDebounce = null;
    adminTaskSearch.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        taskPage = 1;
        loadTasks();
      }, 300);
    });

    adminTaskStatusFilter.addEventListener('change', () => {
      taskPage = 1;
      loadTasks();
    });

    adminTaskDeptFilter.addEventListener('change', () => {
      taskPage = 1;
      loadTasks();
    });

    adminTaskPrevBtn.addEventListener('click', () => {
      if (taskPage > 1) {
        taskPage--;
        loadTasks();
      }
    });

    adminTaskNextBtn.addEventListener('click', () => {
      taskPage++;
      loadTasks();
    });

    // Admin Logout
    document.getElementById('admin-logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });

    // Close admin modals on backdrop click or ESC key
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeAdminModal(overlay.id);
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) {
          closeAdminModal(activeModal.id);
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
