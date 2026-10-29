// Dashboard Frontend Script

(function () {
  'use strict';

  // State
  let currentPage = 1;
  let totalPages = 1;
  const PAGE_SIZE = 3;
  let allOverdueDepartments = [];
  let currentUser = null;
  let rotationTimer = null;
  let isHovered = false;
  const ROTATION_INTERVAL = 5000; // Carousel visual rotation interval

  let modalFilter = {
    status: 'all',
    departmentId: 'all',
    search: '',
    page: 1,
    pageSize: 15
  };

  // DOM Elements
  const metricTotalNum = document.getElementById('metric-total-num');
  const metricProgressNum = document.getElementById('metric-progress-num');
  const metricOverdueNum = document.getElementById('metric-overdue-num');

  const deptSection = document.querySelector('.department-section');
  const deptCardsContainer = document.getElementById('dept-cards-container');
  const prevPageBtn = document.getElementById('prev-page-btn');
  const nextPageBtn = document.getElementById('next-page-btn');
  const pageIndicatorText = document.getElementById('page-indicator-text');
  const paginationDots = document.getElementById('pagination-dots');

  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const fullscreenText = document.getElementById('fullscreen-text');
  const adminLinkBtn = document.getElementById('admin-link-btn');
  const userDisplayName = document.getElementById('user-display-name');
  const userRoleBadge = document.getElementById('user-role-badge');
  const logoutBtn = document.getElementById('logout-btn');

  // Modal DOM
  const taskModal = document.getElementById('task-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const modalFooterCloseBtn = document.getElementById('modal-footer-close-btn');
  const modalTaskTitle = document.getElementById('modal-task-title');
  const modalSearchInput = document.getElementById('modal-search-input');
  const modalDeptSelect = document.getElementById('modal-dept-select');
  const modalTableBody = document.getElementById('modal-table-body');
  const modalEmptyState = document.getElementById('modal-empty-state');
  const modalCountInfo = document.getElementById('modal-count-info');
  const modalPrevBtn = document.getElementById('modal-prev-btn');
  const modalNextBtn = document.getElementById('modal-next-btn');
  const modalPageText = document.getElementById('modal-page-text');

  // Live Tashkent Date and Clock Manager
  let clockTimer = null;
  let clockInitialized = false;

  const UZ_MONTH_NAMES = [
    'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
    'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
  ];

  function formatTashkentDateTime(now = new Date()) {
    try {
      // Format Date in Asia/Tashkent time zone
      const dtf = new Intl.DateTimeFormat('uz-Latn-UZ', {
        timeZone: 'Asia/Tashkent',
        day: 'numeric',
        month: 'numeric',
        year: 'numeric'
      });
      const parts = dtf.formatToParts(now);
      const dayRaw = parts.find(p => p.type === 'day')?.value || String(now.getDate());
      const day = parseInt(dayRaw, 10);
      const monthNum = parseInt(parts.find(p => p.type === 'month')?.value || (now.getMonth() + 1), 10);
      const year = parts.find(p => p.type === 'year')?.value || String(now.getFullYear());
      const monthName = UZ_MONTH_NAMES[monthNum - 1] || 'oy';
      const formattedDate = `${day} ${monthName} ${year}`;

      // Format 24-hour time (HH:mm) in Asia/Tashkent time zone
      const timeFmt = new Intl.DateTimeFormat('uz-Latn-UZ', {
        timeZone: 'Asia/Tashkent',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      });
      const timeParts = timeFmt.formatToParts(now);
      const hour = timeParts.find(p => p.type === 'hour')?.value;
      const minute = timeParts.find(p => p.type === 'minute')?.value;
      const formattedTime = (hour && minute) ? `${hour}:${minute}` : timeFmt.format(now);

      return { formattedDate, formattedTime };
    } catch (_) {
      const day = now.getDate();
      const month = UZ_MONTH_NAMES[now.getMonth()];
      const year = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      return {
        formattedDate: `${day} ${month} ${year}`,
        formattedTime: `${hh}:${mm}`
      };
    }
  }

  function updateHeaderClock() {
    const dateEl = document.getElementById('header-live-date');
    const timeEl = document.getElementById('header-live-time');
    if (!dateEl && !timeEl) return;

    const { formattedDate, formattedTime } = formatTashkentDateTime();
    if (dateEl && dateEl.textContent !== formattedDate) {
      dateEl.textContent = formattedDate;
    }
    if (timeEl && timeEl.textContent !== formattedTime) {
      timeEl.textContent = formattedTime;
    }
  }

  function initHeaderClock() {
    // Render immediately on initial load
    updateHeaderClock();

    if (clockInitialized) return;
    clockInitialized = true;

    // Check periodically to guarantee timely minute rollover and midnight date transition
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(updateHeaderClock, 10000);

    // Refresh immediately when tab gains focus / becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        updateHeaderClock();
      }
    });
  }

  // Initialize - Single controlled data load
  async function init() {
    initHeaderClock();
    await checkAuth();
    await loadSettings();
    await Promise.all([
      fetchStats(),
      fetchDepartments(),
      loadDepartmentOptions()
    ]);
    bindEvents();
    setupCrossTabSync();
    startRotationTimer();
  }

  // Check Authentication
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        return;
      }
      const data = await res.json();
      currentUser = data.user;

      if (currentUser) {
        if (userDisplayName) userDisplayName.textContent = currentUser.fullName || currentUser.username;
        if (userRoleBadge) userRoleBadge.textContent = currentUser.role === 'admin' ? 'Admin' : 'Kuzatuvchi';
        if (adminLinkBtn && currentUser.role === 'admin') {
          adminLinkBtn.style.display = 'inline-flex';
        }
      }
    } catch (err) {
      console.error('Auth verification failed:', err);
    }
  }

  // Load Settings
  async function loadSettings() {
    try {
      const res = await fetch('/api/dashboard/settings', { cache: 'no-store' });
      if (res.ok) {
        const s = await res.json();
        if (s.orgName) document.getElementById('org-name-text').textContent = s.orgName.toUpperCase();
        if (s.subOrgName) document.getElementById('sub-org-text').textContent = `${s.subOrgName} • Ijro intizomi monitoring tizimi`;
        if (s.logoUrl) document.getElementById('brand-logo').src = s.logoUrl;
      }
    } catch (err) {
      console.error('Settings load error:', err);
    }
  }

  // Fetch Summary Stats - Single load from PostgreSQL
  async function fetchStats() {
    try {
      const res = await fetch('/api/dashboard/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('Statistika yuklanmadi');
      const stats = await res.json();

      metricTotalNum.textContent = stats.totalTasks ?? 0;
      metricProgressNum.textContent = stats.inProgressTasks ?? 0;
      metricOverdueNum.textContent = stats.overdueTasks ?? 0;

      return stats;
    } catch (err) {
      console.error('Stats error:', err);
      showToast('Statistikani yuklashda xatolik', 'error');
    }
  }

  // Fetch Departments from server ONCE, then paginate in memory
  async function fetchDepartments() {
    try {
      // Load departments with onlyOverdue=true from database
      const res = await fetch('/api/dashboard/departments?page=1&pageSize=1000&onlyOverdue=true', { cache: 'no-store' });
      if (!res.ok) throw new Error('Boshqarmalar ma’lumoti olinmadi');
      const data = await res.json();

      allOverdueDepartments = data.allItems || data.items || [];
      totalPages = Math.max(1, Math.ceil(allOverdueDepartments.length / PAGE_SIZE));
      currentPage = 1;

      renderCurrentPageDepartments();
    } catch (err) {
      console.error('Departments error:', err);
      showToast('Boshqarmalarni yuklashda xatolik', 'error');
    }
  }

  // Render currently selected page of departments from in-memory cache (NO network request!)
  function renderCurrentPageDepartments() {
    pageIndicatorText.textContent = `${currentPage} / ${totalPages}`;
    prevPageBtn.disabled = totalPages <= 1;
    nextPageBtn.disabled = totalPages <= 1;

    renderPaginationDots(totalPages, currentPage);

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allOverdueDepartments.slice(startIndex, startIndex + PAGE_SIZE);

    deptCardsContainer.classList.add('transitioning');
    setTimeout(() => {
      renderDepartmentCards(pageItems);
      deptCardsContainer.classList.remove('transitioning');
    }, 120);
  }

  // Automatic visual carousel rotation (pure client-side page transition, ZERO server requests)
  function startRotationTimer() {
    stopRotationTimer();
    if (totalPages <= 1) return;

    rotationTimer = setInterval(() => {
      // Don't rotate if hovered or modal is open
      if (isHovered || taskModal.classList.contains('active') || totalPages <= 1) {
        return;
      }
      currentPage = currentPage >= totalPages ? 1 : currentPage + 1;
      renderCurrentPageDepartments();
    }, ROTATION_INTERVAL);
  }

  function stopRotationTimer() {
    if (rotationTimer) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }
  }

  // Render Pagination Dots
  function renderPaginationDots(total, current) {
    paginationDots.innerHTML = '';
    for (let i = 1; i <= total; i++) {
      const dot = document.createElement('span');
      dot.className = `dot ${i === current ? 'active' : ''}`;
      dot.setAttribute('title', `${i}-sahifa`);
      dot.addEventListener('click', () => {
        currentPage = i;
        renderCurrentPageDepartments();
        startRotationTimer();
      });
      paginationDots.appendChild(dot);
    }
  }

  // Helper for Initials
  function getInitials(fullName) {
    if (!fullName) return 'MH';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // Render Department Cards
  function renderDepartmentCards(departments) {
    if (!departments || departments.length === 0) {
      deptCardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: #10b981; font-weight: 700; font-size: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 20px;">
          🎉 Hozirda muddati o‘tgan topshiriqlari mavjud bo‘lgan boshqarmalar yo‘q! Barcha topshiriqlar o‘z vaqtida bajarilmoqda.
        </div>
      `;
      return;
    }

    deptCardsContainer.innerHTML = departments.map(dept => {
      const initials = getInitials(dept.headName);
      const photoUrl = dept.photo || '';
      const portraitHtml = photoUrl
        ? `<img src="${photoUrl}" alt="${dept.headName}" class="portrait-img" onerror="this.outerHTML='<div class=\\'avatar-initials\\'>${initials}</div>'">`
        : `<div class="avatar-initials">${initials}</div>`;

      return `
        <article class="dept-card" data-dept-id="${dept.id}">
          <div class="dept-card-main">
            <div class="dept-navy-header-bg"></div>

            <div class="portrait-wrapper">
              ${portraitHtml}
              <span class="portrait-status-dot" title="Faol"></span>
            </div>

            <div class="dept-emp-name-box">
              <span class="dept-emp-name-text" title="${dept.headName}">${dept.headName}</span>
            </div>

            <div class="dept-title-box">
              <h3 class="dept-title-text" title="${dept.name}">${dept.name}</h3>
            </div>
          </div>

          <div class="dept-overdue-panel" data-dept-id="${dept.id}" data-dept-name="${dept.name}" tabindex="0" role="button" aria-label="${dept.name} ning muddati o‘tgan topshiriqlarini ochish">
            <div class="overdue-panel-left">
              <div class="warning-icon-box" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div class="overdue-labels">
                <span class="overdue-label-title">MUDDATI O‘TGAN</span>
                <span class="overdue-label-sub">Kechikkan topshiriqlar</span>
              </div>
            </div>

            <div class="overdue-panel-right">
              <div class="overdue-v-divider" aria-hidden="true"></div>
              <div class="overdue-count-wrap">
                <span class="overdue-count-num">${dept.overdueCount}</span>
                <span class="overdue-count-suffix">ta</span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Attach click listeners to overdue panels
    document.querySelectorAll('.dept-overdue-panel').forEach(panel => {
      panel.addEventListener('click', () => {
        const deptId = panel.getAttribute('data-dept-id');
        const deptName = panel.getAttribute('data-dept-name');
        openTasksModal({
          status: 'overdue',
          departmentId: deptId,
          title: `Boshqarma: ${deptName} — Kechikkan topshiriqlar`
        });
      });
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          panel.click();
        }
      });
    });
  }

  // Load Department Options for Modal Dropdown
  async function loadDepartmentOptions() {
    try {
      const res = await fetch('/api/dashboard/departments?page=1&pageSize=1000&onlyOverdue=false', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const activeDepts = (data.allItems || data.items || []).filter(d => d.totalTasks > 0);
        modalDeptSelect.innerHTML = '<option value="all">Barcha boshqarmalar</option>' +
          activeDepts.map(d => `<option value="${d.id}">[ID: #${d.leaderId || '-'}] ${d.name}</option>`).join('');
      }
    } catch (err) {
      console.error('Error loading dept options:', err);
    }
  }

  // Open Tasks Modal
  function openTasksModal({ status = 'all', departmentId = 'all', title = 'Topshiriqlar ro‘yxati' }) {
    modalFilter.status = status;
    modalFilter.departmentId = departmentId;
    modalFilter.search = '';
    modalFilter.page = 1;

    modalTaskTitle.textContent = title;
    modalSearchInput.value = '';
    modalDeptSelect.value = departmentId;

    taskModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    stopRotationTimer();
    fetchModalTasks();
  }

  // Close Modal
  function closeTasksModal() {
    taskModal.classList.remove('active');
    document.body.style.overflow = '';
    startRotationTimer();
  }

  // Fetch Tasks for Modal
  async function fetchModalTasks() {
    modalTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px; color: #64748b;">Topshiriqlar yuklanmoqda...</td></tr>`;
    modalEmptyState.style.display = 'none';

    try {
      const params = new URLSearchParams({
        status: modalFilter.status,
        departmentId: modalFilter.departmentId,
        search: modalFilter.search,
        page: modalFilter.page,
        pageSize: modalFilter.pageSize
      });

      const res = await fetch(`/api/tasks?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Topshiriqlarni yuklashda xatolik');
      const data = await res.json();

      modalCountInfo.textContent = `Jami ${data.total} ta topshiriq (Ko‘rsatilmoqda: ${data.items.length} ta)`;
      modalPageText.textContent = `${data.page} / ${data.totalPages}`;
      modalPrevBtn.disabled = data.page <= 1;
      modalNextBtn.disabled = data.page >= data.totalPages;

      if (data.items.length === 0) {
        modalTableBody.innerHTML = '';
        modalEmptyState.style.display = 'block';
        return;
      }

      modalTableBody.innerHTML = data.items.map((t, idx) => {
        const rowNum = (data.page - 1) * data.pageSize + (idx + 1);

        let statusBadge = '';
        if (t.status === 'overdue' || t.computedStatus === 'overdue') {
          const delayText = t.delayDays > 0 ? ` (${t.delayDays} kun kechikkan)` : '';
          statusBadge = `<span class="status-badge overdue">Muddati o‘tgan${delayText}</span>`;
        } else if (t.status === 'completed' || t.computedStatus === 'completed') {
          statusBadge = `<span class="status-badge completed">Bajarilgan</span>`;
        } else {
          statusBadge = `<span class="status-badge in_progress">Bajarish jarayonida</span>`;
        }

        const formattedDeadline = t.deadline || 'Belgilanmagan';

        return `
          <tr>
            <td style="font-weight: 700; color: #64748b;">${rowNum}</td>
            <td>
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">${t.title}</div>
              <div style="font-size: 11.5px; color: #94a3b8;">${t.docType || 'Hujjat'} • ${t.taskType || 'Topshiriq'}</div>
            </td>
            <td style="font-size: 13px; font-weight: 500; color: #334155;">${t.departmentName || '-'}</td>
            <td style="font-size: 13px; font-weight: 600; color: #1e293b;">${t.responsiblePerson || '-'}</td>
            <td style="font-size: 13px; font-weight: 600; color: ${(t.status === 'overdue' || t.computedStatus === 'overdue') ? '#dc2626' : '#2563eb'};">
              ${formattedDeadline}
            </td>
            <td>${statusBadge}</td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      console.error('Modal tasks fetch error:', err);
      modalTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #dc2626; padding: 24px;">Xatolik: ${err.message}</td></tr>`;
    }
  }

  // Toast Notification
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
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

  // Bind Events
  function bindEvents() {
    prevPageBtn.addEventListener('click', () => {
      currentPage = currentPage <= 1 ? totalPages : currentPage - 1;
      renderCurrentPageDepartments();
      startRotationTimer();
    });

    nextPageBtn.addEventListener('click', () => {
      currentPage = currentPage >= totalPages ? 1 : currentPage + 1;
      renderCurrentPageDepartments();
      startRotationTimer();
    });

    if (deptSection) {
      deptSection.addEventListener('mouseenter', () => {
        isHovered = true;
      });
      deptSection.addEventListener('mouseleave', () => {
        isHovered = false;
        startRotationTimer();
      });
    }

    document.getElementById('card-total').addEventListener('click', () => {
      openTasksModal({ status: 'all', departmentId: 'all', title: 'Barcha topshiriqlar ro‘yxati' });
    });

    document.getElementById('card-in-progress').addEventListener('click', () => {
      openTasksModal({ status: 'in_progress', departmentId: 'all', title: 'Bajarish jarayonidagi topshiriqlar' });
    });

    document.getElementById('card-overdue').addEventListener('click', () => {
      openTasksModal({ status: 'overdue', departmentId: 'all', title: 'Muddati o‘tgan topshiriqlar' });
    });

    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.error(err));
        fullscreenText.textContent = 'Odatdagi ekran';
      } else {
        document.exitFullscreen().catch(err => console.error(err));
        fullscreenText.textContent = 'To‘liq ekran';
      }
    });

    document.addEventListener('fullscreenchange', () => {
      fullscreenText.textContent = document.fullscreenElement ? 'Odatdagi ekran' : 'To‘liq ekran';
    });

    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      } catch (err) {
        window.location.href = '/login';
      }
    });

    closeModalBtn.addEventListener('click', closeTasksModal);
    modalFooterCloseBtn.addEventListener('click', closeTasksModal);
    taskModal.addEventListener('click', (e) => {
      if (e.target === taskModal) closeTasksModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && taskModal.classList.contains('active')) {
        closeTasksModal();
      }
    });

    let searchDebounce = null;
    modalSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        modalFilter.search = e.target.value;
        modalFilter.page = 1;
        fetchModalTasks();
      }, 300);
    });

    modalDeptSelect.addEventListener('change', (e) => {
      modalFilter.departmentId = e.target.value;
      modalFilter.page = 1;
      fetchModalTasks();
    });

    modalPrevBtn.addEventListener('click', () => {
      if (modalFilter.page > 1) {
        modalFilter.page--;
        fetchModalTasks();
      }
    });

    modalNextBtn.addEventListener('click', () => {
      modalFilter.page++;
      fetchModalTasks();
    });
  }

  // Cross-tab synchronization when Admin imports new Excel in another tab
  function setupCrossTabSync() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('ijro_monitoring_channel');
        bc.onmessage = async (ev) => {
          if (ev.data && ev.data.type === 'DATA_UPDATED') {
            await Promise.all([fetchStats(), fetchDepartments(), loadDepartmentOptions()]);
            showToast('Ma’lumotlar yangilandi', 'success');
          }
        };
      } catch (_) {}
    }

    window.addEventListener('storage', async (ev) => {
      if (ev.key === 'ijro_data_sync_time') {
        await Promise.all([fetchStats(), fetchDepartments(), loadDepartmentOptions()]);
        showToast('Ma’lumotlar yangilandi', 'success');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
