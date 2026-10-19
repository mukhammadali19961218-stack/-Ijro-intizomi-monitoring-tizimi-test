// Dashboard Frontend Script

(function () {
  'use strict';

  // State
  // State - Always start at page 1 on refresh so critical overdue departments are immediately visible
  let currentPage = 1;
  let totalPages = 1;
  let currentUser = null;
  let autoRefreshTimer = null;
  let rotationTimer = null;
  let isHovered = false;
  const ROTATION_INTERVAL = 5000; // Har 5 sekundda almashish

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

  const refreshBtn = document.getElementById('refresh-btn');
  const refreshLabel = document.getElementById('refresh-label');
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

  // Initialize
  async function init() {
    await checkAuth();
    await loadSettings();
    await fetchStats();
    await fetchDepartments(1);
    await loadDepartmentOptions();
    bindEvents();
    startAutoRefresh();
    startRotationTimer();
  }

  // Check Authentication
  async function checkAuth() {
    try {
      const res = await fetch(`/api/auth/me?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        return;
      }
      const data = await res.json();
      currentUser = data.user;

      if (currentUser) {
        userDisplayName.textContent = currentUser.fullName || currentUser.username;
        userRoleBadge.textContent = currentUser.role === 'admin' ? 'Admin' : 'Kuzatuvchi';
        if (currentUser.role === 'admin') {
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
      const res = await fetch(`/api/dashboard/settings?_t=${Date.now()}`, { cache: 'no-store' });
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

  // Fetch Summary Stats
  async function fetchStats() {
    try {
      const res = await fetch(`/api/dashboard/stats?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Statistika yuklanmadi');
      const stats = await res.json();

      metricTotalNum.textContent = stats.totalTasks ?? 0;
      metricProgressNum.textContent = stats.inProgressTasks ?? 0;
      metricOverdueNum.textContent = stats.overdueTasks ?? 0;

      const dateObj = new Date(stats.lastUpdated || Date.now());
      const timeStr = dateObj.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
      refreshLabel.textContent = `Yangilandi: ${timeStr}`;
    } catch (err) {
      console.error('Stats error:', err);
      showToast('Statistikani yangilashda xatolik', 'error');
    }
  }

  // Fetch Departments (Paginated, 3 per page, only with overdue tasks)
  async function fetchDepartments(page = 1, isAuto = false) {
    try {
      // onlyOverdue=true: Faqat muddati o‘tgan topshiriqlari bor boshqarmalar ko‘rsatiladi
      const res = await fetch(`/api/dashboard/departments?page=${page}&pageSize=3&onlyOverdue=true&_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Boshqarmalar ma’lumoti olinmadi');
      const data = await res.json();

      // If requested page is out of bounds (e.g. data changed), adjust
      currentPage = data.page;
      totalPages = data.totalPages;

      pageIndicatorText.textContent = `${currentPage} / ${totalPages}`;
      prevPageBtn.disabled = totalPages <= 1;
      nextPageBtn.disabled = totalPages <= 1;

      renderPaginationDots(totalPages, currentPage);

      // Smooth visual transition
      deptCardsContainer.classList.add('transitioning');
      setTimeout(() => {
        renderDepartmentCards(data.items);
        deptCardsContainer.classList.remove('transitioning');
      }, 150);

    } catch (err) {
      console.error('Departments error:', err);
      showToast('Boshqarmalarni yuklashda xatolik', 'error');
    }
  }

  // 5-second Automatic Carousel Rotation
  function startRotationTimer() {
    stopRotationTimer();
    rotationTimer = setInterval(() => {
      // Don't rotate if hovered, or modal is open, or only 1 page
      if (isHovered || taskModal.classList.contains('active') || totalPages <= 1) {
        return;
      }
      const nextPage = currentPage >= totalPages ? 1 : currentPage + 1;
      fetchDepartments(nextPage, true);
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
        fetchDepartments(i);
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

  // Helper for Cache-busted Photo URL
  function getPhotoUrl(photo, updatedAt) {
    if (!photo) return '';
    const cleanUrl = photo.split('?')[0];
    const v = updatedAt ? new Date(updatedAt).getTime() : Date.now();
    return `${cleanUrl}?v=${v}`;
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
      const photoUrl = dept.photo ? getPhotoUrl(dept.photo, dept.updatedAt) : '';
      const portraitHtml = photoUrl
        ? `<img src="${photoUrl}" alt="${dept.headName}" class="portrait-img" onerror="this.outerHTML='<div class=\\'avatar-initials\\'>${initials}</div>'">`
        : `<div class="avatar-initials">${initials}</div>`;

      return `
        <article class="dept-card" data-dept-id="${dept.id}">
          <div class="dept-card-top">
            <!-- Enlarged Executive Portrait Container -->
            <div class="portrait-wrapper">
              ${portraitHtml}
              <span class="portrait-status-dot" title="Faol"></span>
            </div>

            <div class="dept-info-col">
              <div class="dept-name-badge" title="${dept.name}">
                <svg class="dept-building-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
                  <path d="M6 12H4a2 2 0 0 0-2 2v8h4"/>
                  <path d="M18 9h2a2 2 0 0 1 2 2v11h-4"/>
                  <path d="M10 6h4"/>
                  <path d="M10 10h4"/>
                  <path d="M10 14h4"/>
                  <path d="M10 18h4"/>
                </svg>
                <span class="dept-name-text">${dept.name}</span>
              </div>

              <div class="head-name-wrapper">
                <h3 class="head-full-name">${dept.headName}</h3>
                <div class="head-role-label">
                  <span class="role-bullet"></span>
                  <span>${dept.headTitle || 'Mas’ul rahbar'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom full-width pale pink overdue panel -->
          <div class="dept-overdue-panel" data-dept-id="${dept.id}" data-dept-name="${dept.name}" tabindex="0" role="button" aria-label="${dept.name} ning muddati o‘tgan topshiriqlarini ochish">
            <div class="overdue-panel-left">
              <div class="warning-icon-box" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
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
              <span class="overdue-count-num">${dept.overdueCount}</span>
              <span class="overdue-count-suffix">ta</span>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Attach click listeners to overdue panels
    document.querySelectorAll('.dept-overdue-panel').forEach(panel => {
      panel.addEventListener('click', (e) => {
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
      const res = await fetch(`/api/dashboard/departments?page=1&pageSize=100&onlyOverdue=false&_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        // Only include departments that have tasks in the active import
        const activeDepts = (data.items || []).filter(d => d.totalTasks > 0);
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

    stopRotationTimer(); // Pause rotation while user views modal
    fetchModalTasks();
  }

  // Close Modal
  function closeTasksModal() {
    taskModal.classList.remove('active');
    document.body.style.overflow = '';
    startRotationTimer(); // Resume rotation
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
        pageSize: modalFilter.pageSize,
        _t: Date.now()
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
        if (t.computedStatus === 'overdue') {
          const delayText = t.delayDays > 0 ? ` (${t.delayDays} kun kechikkan)` : '';
          statusBadge = `<span class="status-badge overdue">Muddati o‘tgan${delayText}</span>`;
        } else if (t.computedStatus === 'completed') {
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
            <td style="font-size: 13px; font-weight: 500; color: #334155;">${t.departmentName}</td>
            <td style="font-size: 13px; font-weight: 600; color: #1e293b;">${t.responsiblePerson}</td>
            <td style="font-size: 13px; font-weight: 600; color: ${t.computedStatus === 'overdue' ? '#dc2626' : '#2563eb'};">
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
    // Pagination Controls with wrap-around
    prevPageBtn.addEventListener('click', () => {
      const prev = currentPage <= 1 ? totalPages : currentPage - 1;
      fetchDepartments(prev);
      startRotationTimer();
    });

    nextPageBtn.addEventListener('click', () => {
      const next = currentPage >= totalPages ? 1 : currentPage + 1;
      fetchDepartments(next);
      startRotationTimer();
    });

    // Pause on hover over department section
    if (deptSection) {
      deptSection.addEventListener('mouseenter', () => {
        isHovered = true;
      });
      deptSection.addEventListener('mouseleave', () => {
        isHovered = false;
        startRotationTimer();
      });
    }

    // Summary Cards Clicks
    document.getElementById('card-total').addEventListener('click', () => {
      openTasksModal({ status: 'all', departmentId: 'all', title: 'Barcha topshiriqlar ro‘yxati' });
    });

    document.getElementById('card-in-progress').addEventListener('click', () => {
      openTasksModal({ status: 'in_progress', departmentId: 'all', title: 'Bajarish jarayonidagi topshiriqlar' });
    });

    document.getElementById('card-overdue').addEventListener('click', () => {
      openTasksModal({ status: 'overdue', departmentId: 'all', title: 'Muddati o‘tgan topshiriqlar' });
    });

    // Refresh Button - Immediately fetches latest data from server
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      if (refreshLabel) refreshLabel.textContent = 'Yangilanmoqda...';
      currentPage = 1;
      try {
        await Promise.all([
          fetchStats(),
          fetchDepartments(1),
          loadDepartmentOptions()
        ]);
        showToast('Ma’lumotlar muvaffaqiyatli yangilandi', 'success');
      } catch (err) {
        showToast('Ma’lumotlarni yangilashda xatolik', 'error');
      } finally {
        setTimeout(() => {
          refreshBtn.classList.remove('spinning');
        }, 400);
        startRotationTimer();
      }
    });

    // Fullscreen Toggle
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

    // Logout
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      } catch (err) {
        window.location.href = '/login';
      }
    });

    // Modal Events
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

  // Auto-refresh interval (polling from server every 30s)
  function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(async () => {
      await Promise.all([fetchStats(), fetchDepartments(currentPage, true)]);
    }, 30000);
  }

  // Run on load
  document.addEventListener('DOMContentLoaded', init);
})();
