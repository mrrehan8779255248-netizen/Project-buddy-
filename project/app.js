// ===== PROJECTBUDDY CORE CONTROLLER & DATA STORE =====
// Local storage is a UI cache only. Accounts and activity are authenticated through the API/MongoDB.
const DB_KEY = 'projectbuddy_prod_db';
const TOKEN_KEY = 'projectbuddy_session_token';

function getDB() {
    // Preserve legacy browser-only records as a backup; new writes use the API/MongoDB.
    // Old local caches are never treated as the source of truth for authenticated accounts.
    let db;
    try { db = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch { db = null; }
    if (!db || typeof db !== 'object') {
        db = { users: [], projects: [], requests: [], announcements: [], collaborationMessages: [], currentUserId: null };
    }
    db.users = Array.isArray(db.users) ? db.users.filter(u => u && u.id !== 'user_admin' && String(u.email || '').toLowerCase() !== 'admin@projectbuddy.edu') : [];
    db.users.forEach(u => { delete u.password; delete u.role; });
    if (db.currentUserId === 'user_admin' || !sessionStorage.getItem(TOKEN_KEY)) db.currentUserId = null;
    if (!Array.isArray(db.projects)) db.projects = [];
    if (!Array.isArray(db.requests)) db.requests = [];
    if (!Array.isArray(db.announcements) || db.announcements.length === 0) {
        db.announcements = [{ id: 'ann_welcome', title: 'Welcome to ProjectBuddy', message: 'Share project ideas, discover collaborators, and work together.', category: 'announcement', active: true, createdAt: new Date().toISOString() }];
    }
    if (!Array.isArray(db.collaborationMessages)) db.collaborationMessages = [];
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return db;
}

function saveDB(db) {
    (db.users || []).forEach(u => { delete u.password; delete u.role; });
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

async function apiRequest(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
        response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    } catch {
        throw new Error('Cannot reach ProjectBuddy right now. Check your internet connection and retry.');
    }
    let result = {};
    try { result = await response.json(); } catch { /* response may be empty */ }
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
    return result;
}

function mapBackendUser(user) {
    if (!user) return null;
    return {
        id: String(user._id || user.id), name: user.name || '', email: user.email || '',
        university: user.university || '', department: user.department || 'Other', year: user.year || '',
        skills: user.skills || [], bio: user.bio || '', status: user.status || 'active',
        anonToken: user.anonToken || '', bookmarks: (user.bookmarks || []).map(b => String(b._id || b)),
        createdAt: user.createdAt || new Date().toISOString(), lastLoginAt: user.lastLoginAt || null
    };
}

function mapBackendProject(project) {
    const author = project.user && typeof project.user === 'object' ? mapBackendUser(project.user) : null;
    return {
        id: String(project._id || project.id), userId: author ? author.id : String(project.user || ''),
        title: project.title || '', description: project.description || '', department: project.department || 'Other',
        difficulty: project.difficulty || 'Beginner', skills: project.skills || [], teamSize: project.teamSize || '1 Partner',
        status: project.status || 'Looking for Partners', isFlagged: Boolean(project.isFlagged), reports: project.reports || [],
        createdAt: project.createdAt || new Date().toISOString(), isBookmarked: Boolean(project.isBookmarked),
        isOwner: Boolean(project.isOwner), isPartner: Boolean(project.isPartner), requestStatus: project.requestStatus || null
    };
}

function mapBackendRequest(request) {
    const fromId = request.fromUser && request.fromUser._id ? String(request.fromUser._id) : String(request.fromUser || '');
    const toId = request.toUser && request.toUser._id ? String(request.toUser._id) : String(request.toUser || '');
    const projectId = request.project && request.project._id ? String(request.project._id) : String(request.project || '');
    return { id: String(request._id || request.id), fromUserId: fromId, toUserId: toId, projectId,
        message: request.message || '', status: request.status || 'pending', createdAt: request.createdAt || new Date().toISOString() };
}

async function loadBackendState(userPayload) {
    const meRaw = userPayload || await apiRequest('/api/auth/me');
    const [projectPayload, received, sent] = await Promise.all([
        apiRequest('/api/projects'), apiRequest('/api/requests/received'), apiRequest('/api/requests/sent')
    ]);
    const db = getDB();
    const usersById = new Map();
    const addUser = raw => {
        const u = mapBackendUser(raw);
        if (u && u.id && !usersById.has(u.id)) usersById.set(u.id, u);
        return u;
    };
    const me = addUser(meRaw);
    const projects = (projectPayload.projects || []).map(p => {
        if (p.user && typeof p.user === 'object') addUser(p.user);
        return mapBackendProject(p);
    });
    const requestsById = new Map();
    [...(received || []), ...(sent || [])].forEach(r => {
        if (r.fromUser && typeof r.fromUser === 'object') addUser(r.fromUser);
        if (r.toUser && typeof r.toUser === 'object') addUser(r.toUser);
        requestsById.set(String(r._id || r.id), mapBackendRequest(r));
    });
    db.users = [...usersById.values()];
    db.projects = projects;
    db.requests = [...requestsById.values()];
    db.currentUserId = me.id;
    // Refresh current user's bookmarks from the durable account record.
    const current = db.users.find(u => u.id === me.id);
    if (current) current.bookmarks = me.bookmarks || [];
    saveDB(db);
    return db;
}

async function refreshBackendState() {
    const me = await apiRequest('/api/auth/me');
    return loadBackendState(me);
}

function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function getInitials(name) {
    if (!name) return 'PB';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function timeAgo(dateStr) {
    if (!dateStr) return 'Recently';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

// ===== SKILL MATCH COMPATIBILITY ENGINE =====
function calculateSkillMatch(projectSkills, userSkills) {
    if (!projectSkills || projectSkills.length === 0 || !userSkills || userSkills.length === 0) {
        return 0;
    }
    const userLower = userSkills.map(s => s.toLowerCase().trim());
    let matchCount = 0;
    projectSkills.forEach(ps => {
        const psLower = ps.toLowerCase().trim();
        if (userLower.includes(psLower) || userLower.some(u => u.includes(psLower) || psLower.includes(u))) {
            matchCount++;
        }
    });
    return Math.min(100, Math.round((matchCount / projectSkills.length) * 100));
}

// ===== PAGE ROUTING =====
let currentPage = 'landing';
let activeCollabProjectId = null;

function showPage(pageId) {
    const db = getDB();


    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const target = document.getElementById('page-' + pageId);
    if (target) target.classList.remove('hidden');

    currentPage = pageId;
    window.scrollTo(0, 0);

    // Update active nav indicators
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

    switch (pageId) {
        case 'feed': renderFeed(); break;
        case 'discover': renderDiscover(); break;
        case 'my-projects': renderMyProjects('posted'); break;
        case 'requests': renderRequests('received'); break;
        case 'profile': renderProfile(); break;
    }

    // Toggle footer
    const footer = document.getElementById('mainFooter');
    if (['login', 'register', 'recovery'].includes(pageId)) {
        footer.classList.add('hidden');
    } else {
        footer.classList.remove('hidden');
    }
}

function requireAuth() {
    const db = getDB();
    if (!db.currentUserId) {
        showPage('login');
        return false;
    }
    return true;
}

function getCurrentUser() {
    const db = getDB();
    return db.users.find(u => u.id === db.currentUserId);
}

// ===== AUTH HANDLERS =====
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
        const result = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        sessionStorage.setItem(TOKEN_KEY, result.token);
        const db = await loadBackendState(result);
        updateNavState(true);
        showPage('feed');
        showToast(`Welcome back, ${db.users.find(u => u.id === db.currentUserId)?.name?.split(' ')[0] || 'back'}!`);
    } catch (error) {
        showToast(error.message || 'Sign in failed. Please check your details.');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('regName').value.trim(),
        email: document.getElementById('regEmail').value.trim(),
        password: document.getElementById('regPassword').value,
        university: document.getElementById('regUniversity').value.trim(),
        department: document.getElementById('regDepartment').value,
        year: document.getElementById('regYear').value,
        skills: document.getElementById('regSkills').value.split(',').map(s => s.trim()).filter(Boolean),
        bio: document.getElementById('regBio').value.trim()
    };
    if (payload.skills.length === 0) { showToast('Add at least one skill to your profile.'); return; }
    try {
        const result = await apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        sessionStorage.setItem(TOKEN_KEY, result.token);
        const db = await loadBackendState(result);
        updateNavState(true);
        showPage('feed');
        showToast(`Welcome to ProjectBuddy, ${db.users.find(u => u.id === db.currentUserId)?.name?.split(' ')[0] || 'student'}!`);
    } catch (error) {
        showToast(error.message || 'Could not create your account. Please try again.');
    }
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value.trim();
    const status = document.getElementById('recoveryStatus');
    const btn = document.getElementById('sendOtpButton');
    btn.disabled = true;
    try {
        const result = await apiRequest('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        document.getElementById('resetEmail').value = email;
        document.getElementById('resetOtpForm').classList.remove('hidden');
        status.textContent = result.message || 'If this email belongs to an account, a code will be sent shortly.';
        status.classList.remove('error-text');
    } catch (error) {
        status.textContent = error.message || 'Could not send a recovery code.';
        status.classList.add('error-text');
    } finally { btn.disabled = false; }
}

async function resendPasswordOtp() {
    const email = document.getElementById('resetEmail').value.trim();
    const status = document.getElementById('recoveryStatus');
    try {
        const result = await apiRequest('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        status.textContent = result.message || 'If the account exists, a new code will be sent shortly.';
        status.classList.remove('error-text');
    } catch (error) {
        status.textContent = error.message || 'Could not resend the code.';
        status.classList.add('error-text');
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    const otp = document.getElementById('resetOtp').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;
    const confirmPassword = document.getElementById('resetConfirmPassword').value;
    const status = document.getElementById('recoveryStatus');
    if (newPassword.length < 8) { status.textContent = 'Use at least 8 characters for your new password.'; status.classList.add('error-text'); return; }
    if (newPassword !== confirmPassword) { status.textContent = 'The two passwords do not match.'; status.classList.add('error-text'); return; }
    try {
        const result = await apiRequest('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, otp, newPassword }) });
        status.textContent = result.message || 'Password updated. Please sign in.';
        status.classList.remove('error-text');
        document.getElementById('resetOtpForm').classList.add('hidden');
        document.getElementById('forgotPasswordForm').classList.remove('hidden');
        document.getElementById('forgotPasswordForm').reset();
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPassword').value = '';
        setTimeout(() => showPage('login'), 1200);
    } catch (error) {
        status.textContent = error.message || 'Could not reset the password.';
        status.classList.add('error-text');
    }
}

function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    const db = getDB();
    db.currentUserId = null;
    db.users = [];
    db.projects = [];
    db.requests = [];
    db.collaborationMessages = [];
    saveDB(db);
    updateNavState(false);
    showPage('landing');
    showToast('Signed out securely');
}

function updateNavState(loggedIn) {
    document.getElementById('navLoggedOut').classList.toggle('hidden', loggedIn);
    document.getElementById('navLoggedIn').classList.toggle('hidden', !loggedIn);

    if (loggedIn) {
        const user = getCurrentUser();
        if (user) {
            const initials = getInitials(user.name);
            const avatarEls = ['feedAvatar', 'feedPromptAvatar', 'profileAvatar'];
            avatarEls.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = initials;
            });

            const feedName = document.getElementById('feedName');
            const feedInfo = document.getElementById('feedInfo');
            const feedUni = document.getElementById('feedUni');
            if (feedName) feedName.textContent = user.name;
            if (feedInfo) feedInfo.textContent = `${user.department} • ${user.year}`;
            if (feedUni) feedUni.textContent = user.university;


            const profileNav = document.getElementById('navProfileItem');
            if (profileNav) {
                profileNav.classList.remove('hidden');
            }
        }
        updateRequestBadge();
    }
}

function updateRequestBadge() {
    const db = getDB();
    const count = db.requests.filter(r => r.toUserId === db.currentUserId && r.status === 'pending').length;
    const badge = document.getElementById('requestBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// ===== ANNOUNCEMENTS BANNER =====
function loadLatestAnnouncement() {
    const db = getDB();
    const activeAnn = (db.announcements || []).filter(a => a.active);
    const banner = document.getElementById('announcementBanner');
    const textEl = document.getElementById('announcementText');

    if (activeAnn.length > 0 && banner && textEl) {
        textEl.textContent = activeAnn[0].message;
        banner.classList.remove('hidden');
    } else if (banner) {
        banner.classList.add('hidden');
    }
}

function dismissAnnouncement() {
    const banner = document.getElementById('announcementBanner');
    if (banner) banner.classList.add('hidden');
}

// ===== BOOKMARK / WATCHLIST =====
async function toggleBookmark(projectId, event) {
    if (event) event.stopPropagation();
    if (!requireAuth()) return;
    try {
        await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/bookmark`, { method: 'POST', body: '{}' });
        await refreshBackendState();
        showToast('Watchlist updated');
        if (currentPage === 'feed') renderFeed(); else if (currentPage === 'discover') renderDiscover();
    } catch (error) { showToast(error.message || 'Could not update watchlist.'); }
}

// ===== REPORT PROJECT =====
function openReportModal(projectId, event) {
    if (event) event.stopPropagation();
    if (!requireAuth()) return;

    document.getElementById('reportProjectId').value = projectId;
    document.getElementById('reportModal').classList.remove('hidden');
}

async function handleSendReport(e) {
    e.preventDefault();
    const projectId = document.getElementById('reportProjectId').value;
    const reason = document.getElementById('reportReason').value;
    try {
        await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
        closeModal('reportModal');
        showToast('Report submitted. Thank you for helping keep ProjectBuddy safe.');
        await refreshBackendState();
    } catch (error) { showToast(error.message || 'Could not submit report.'); }
}

// ===== FEED RENDERING =====
let currentFeedFilter = 'all';

function renderFeed(filter) {
    if (!requireAuth()) return;
    if (filter) currentFeedFilter = filter;

    const db = getDB();
    const user = getCurrentUser();

    // Update stats
    const myProjects = db.projects.filter(p => p.userId === user.id);
    const myPartners = db.requests.filter(r =>
        (r.fromUserId === user.id || r.toUserId === user.id) && r.status === 'accepted'
    );
    const mySaved = user.bookmarks ? user.bookmarks.length : 0;

    const projCountEl = document.getElementById('myProjectCount');
    const partnerCountEl = document.getElementById('myPartnerCount');
    const savedCountEl = document.getElementById('mySavedCount');

    if (projCountEl) projCountEl.textContent = myProjects.length;
    if (partnerCountEl) partnerCountEl.textContent = myPartners.length;
    if (savedCountEl) savedCountEl.textContent = mySaved;

    let projects = [...db.projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Filter logic
    if (currentFeedFilter === 'saved') {
        const bookmarks = user.bookmarks || [];
        projects = projects.filter(p => bookmarks.includes(p.id));
    } else if (currentFeedFilter === 'matched') {
        projects = projects.filter(p => calculateSkillMatch(p.skills, user.skills) >= 50);
    } else if (currentFeedFilter !== 'all') {
        projects = projects.filter(p => p.department === currentFeedFilter);
    }

    const container = document.getElementById('feedProjects');
    if (!container) return;

    if (projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-folder-open"></i>
                <h3>No projects found in this feed</h3>
                <p>Be the first student to post a project idea title and start discovering collaborators!</p>
                <button class="btn btn-primary" onclick="openPostModal()">
                    <i class="fas fa-plus"></i> Post a Project
                </button>
            </div>
        `;
        renderSuggestions();
        return;
    }

    container.innerHTML = projects.map(project => {
        const author = db.users.find(u => u.id === project.userId);
        if (!author) return '';

        const isOwner = project.userId === user.id;
        const hasRequested = db.requests.find(r => r.fromUserId === user.id && r.projectId === project.id);
        const isPartner = db.requests.find(r =>
            r.projectId === project.id &&
            r.status === 'accepted' &&
            (r.fromUserId === user.id || r.toUserId === user.id)
        );

        const isBookmarked = (user.bookmarks || []).includes(project.id);
        const matchPercent = calculateSkillMatch(project.skills, user.skills);

        let actionBtn = '';
        if (isOwner) {
            actionBtn = `<button class="btn btn-ghost btn-sm" onclick="viewProject('${project.id}')">
                <i class="fas fa-eye"></i> View Blueprint
            </button>`;
        } else if (isPartner) {
            actionBtn = `<button class="btn btn-success btn-sm" onclick="openCollaborationRoom('${project.id}')">
                <i class="fas fa-comments"></i> Open Collaboration Room
            </button>`;
        } else if (hasRequested) {
            actionBtn = `<span class="request-pending request-status"><i class="fas fa-clock"></i> Proposal Sent</span>`;
        } else {
            actionBtn = `<button class="btn btn-primary btn-sm" onclick="openRequestModal('${project.id}')">
                <i class="fas fa-handshake"></i> Send Proposal
            </button>`;
        }

        const matchBadge = matchPercent > 0 ? `
            <span class="skill-match-tag ${matchPercent >= 70 ? 'high-match' : ''}">
                <i class="fas fa-bolt"></i> ${matchPercent}% Skill Match
            </span>
        ` : '';

        return `
            <div class="project-card">
                <div class="project-card-header">
                    <div class="project-card-avatar">${escapeHtml(getInitials(author.name))}</div>
                    <div class="project-card-meta">
                        <h4>${escapeHtml(author.name)}</h4>
                        <span>${escapeHtml(author.department)} • ${escapeHtml(author.university)} • ${timeAgo(project.createdAt)}</span>
                    </div>
                    <div class="project-card-header-actions">
                        <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" onclick="toggleBookmark('${project.id}', event)" title="Save to Watchlist">
                            <i class="${isBookmarked ? 'fas fa-star' : 'far fa-star'}"></i>
                        </button>
                        <button class="report-btn" onclick="openReportModal('${project.id}', event)" title="Report Inappropriate Content">
                            <i class="far fa-flag"></i>
                        </button>
                    </div>
                </div>

                ${matchBadge}
                <h3 class="project-card-title">${escapeHtml(project.title)}</h3>

                <div class="project-card-hidden">
                    <i class="fas fa-shield-alt"></i>
                    <span>Detailed idea and architecture stay hidden until the creator accepts your partnership proposal.</span>
                </div>

                <div class="project-card-tags">
                    ${project.skills.map(s => `<span class="project-tag">${escapeHtml(s)}</span>`).join('')}
                </div>

                <div class="project-card-footer">
                    <div class="project-card-info">
                        <span><i class="fas fa-layer-group"></i> ${escapeHtml(project.difficulty)}</span>
                        <span><i class="fas fa-users"></i> ${escapeHtml(project.teamSize)}</span>
                        <span><i class="fas fa-tag"></i> ${escapeHtml(project.department)}</span>
                    </div>
                    ${actionBtn}
                </div>
            </div>
        `;
    }).join('');

    renderSuggestions();
}

function filterFeed(filter, btn) {
    document.querySelectorAll('.feed-filters .filter-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderFeed(filter);
}

function quickFilterSkill(skill) {
    showPage('discover');
    const searchInput = document.getElementById('discoverSearch');
    if (searchInput) {
        searchInput.value = skill;
        filterDiscover();
    }
}

function renderSuggestions() {
    const db = getDB();
    const user = getCurrentUser();
    const container = document.getElementById('suggestedProjects');
    if (!container || !user) return;

    const otherProjects = db.projects
        .filter(p => p.userId !== user.id)
        .filter(p => !db.requests.find(r => r.fromUserId === user.id && r.projectId === p.id))
        .map(p => ({
            ...p,
            matchScore: calculateSkillMatch(p.skills, user.skills)
        }))
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3);

    if (otherProjects.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No peer projects yet. Share your project title to start partnering!</p>';
        return;
    }

    container.innerHTML = otherProjects.map(p => `
        <div class="suggested-item">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4>${escapeHtml(p.title)}</h4>
                <span class="match-pill">${p.matchScore}% Match</span>
            </div>
            <p>${escapeHtml(p.skills.slice(0, 3).join(', '))} • ${escapeHtml(p.difficulty)}</p>
            <button class="btn btn-outline btn-sm" onclick="openRequestModal('${p.id}')">
                <i class="fas fa-handshake"></i> Propose
            </button>
        </div>
    `).join('');
}

// ===== DISCOVER PAGE =====
function renderDiscover() {
    if (!requireAuth()) return;

    const db = getDB();
    const user = getCurrentUser();
    const search = (document.getElementById('discoverSearch')?.value || '').toLowerCase();
    const dept = document.getElementById('discoverDept')?.value || '';
    const difficulty = document.getElementById('discoverDifficulty')?.value || '';

    let projects = [...db.projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (search) {
        projects = projects.filter(p =>
            p.title.toLowerCase().includes(search) ||
            p.skills.some(s => s.toLowerCase().includes(search)) ||
            p.department.toLowerCase().includes(search)
        );
    }
    if (dept) {
        projects = projects.filter(p => p.department === dept);
    }
    if (difficulty) {
        projects = projects.filter(p => p.difficulty === difficulty);
    }

    const container = document.getElementById('discoverGrid');
    if (!container) return;

    if (projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <i class="fas fa-compass"></i>
                <h3>No projects in the directory yet</h3>
                <p>Be the pioneer student to publish a project title for your university or domain!</p>
                <button class="btn btn-primary" onclick="openPostModal()">
                    <i class="fas fa-plus"></i> Post a Project
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = projects.map(project => {
        const author = db.users.find(u => u.id === project.userId);
        if (!author) return '';

        const isOwner = project.userId === user.id;
        const hasRequested = db.requests.find(r => r.fromUserId === user.id && r.projectId === project.id);
        const isPartner = db.requests.find(r =>
            r.projectId === project.id &&
            r.status === 'accepted' &&
            (r.fromUserId === user.id || r.toUserId === user.id)
        );
        const matchPercent = calculateSkillMatch(project.skills, user.skills);
        const isBookmarked = (user.bookmarks || []).includes(project.id);

        let actionBtn = '';
        if (isOwner) {
            actionBtn = `<button class="btn btn-ghost btn-sm" onclick="viewProject('${project.id}')">View</button>`;
        } else if (isPartner) {
            actionBtn = `<button class="btn btn-success btn-sm" onclick="openCollaborationRoom('${project.id}')">
                <i class="fas fa-comments"></i> Room
            </button>`;
        } else if (hasRequested) {
            actionBtn = `<span class="request-pending request-status">Proposed</span>`;
        } else {
            actionBtn = `<button class="btn btn-primary btn-sm" onclick="openRequestModal('${project.id}')">
                <i class="fas fa-handshake"></i> Propose
            </button>`;
        }

        return `
            <div class="discover-card" onclick="viewProject('${project.id}')">
                <div class="discover-card-top">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="discover-card-dept">${escapeHtml(project.department)}</span>
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${matchPercent > 0 ? `<span class="match-pill">${matchPercent}% Match</span>` : ''}
                            <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" onclick="toggleBookmark('${project.id}', event)">
                                <i class="${isBookmarked ? 'fas fa-star' : 'far fa-star'}"></i>
                            </button>
                        </div>
                    </div>
                    <h3 class="discover-card-title">${escapeHtml(project.title)}</h3>
                    <div class="discover-card-hidden">
                        <i class="fas fa-shield-alt"></i> Blueprint hidden until partnered
                    </div>
                    <div class="discover-card-tags">
                        ${project.skills.map(s => `<span class="project-tag">${escapeHtml(s)}</span>`).join('')}
                    </div>
                </div>
                <div class="discover-card-bottom" onclick="event.stopPropagation();">
                    <div class="discover-card-author">
                        <div class="discover-card-author-avatar">${escapeHtml(getInitials(author.name))}</div>
                        <div class="discover-card-author-info">
                            <strong>${escapeHtml(author.name)}</strong>
                            <span>${escapeHtml(author.year)} • ${escapeHtml(author.university)}</span>
                        </div>
                    </div>
                    ${actionBtn}
                </div>
            </div>
        `;
    }).join('');
}

function filterDiscover() {
    renderDiscover();
}

// ===== MY PROJECTS =====
let myProjectTab = 'posted';

function renderMyProjects(tab) {
    if (!requireAuth()) return;
    myProjectTab = tab || myProjectTab;

    const db = getDB();
    const user = getCurrentUser();
    const container = document.getElementById('myProjectsList');

    const myPosted = db.projects.filter(p => p.userId === user.id);
    const myPartnered = db.requests.filter(r =>
        r.status === 'accepted' && (r.fromUserId === user.id || r.toUserId === user.id)
    );

    document.getElementById('myPostedCountBadge').textContent = myPosted.length;
    document.getElementById('myPartneredCountBadge').textContent = myPartnered.length;

    if (myProjectTab === 'posted') {
        if (myPosted.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lightbulb"></i>
                    <h3>You haven't posted any projects yet</h3>
                    <p>Post a project title securely. Your detailed idea remains protected!</p>
                    <button class="btn btn-primary" onclick="openPostModal()">
                        <i class="fas fa-plus"></i> Post a Project
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = myPosted.map(p => {
            const pendingReqs = db.requests.filter(r => r.projectId === p.id && r.status === 'pending');
            const acceptedPartners = db.requests.filter(r => r.projectId === p.id && r.status === 'accepted');

            return `
                <div class="my-project-item">
                    <div class="my-project-item-header">
                        <div>
                            <h3>${escapeHtml(p.title)}</h3>
                            <span style="font-size: 0.8rem; color: var(--text-muted);">
                                ${escapeHtml(p.department)} • ${escapeHtml(p.difficulty)} • Posted ${timeAgo(p.createdAt)}
                            </span>
                        </div>
                        <span class="project-card-status status-looking">${escapeHtml(p.status)}</span>
                    </div>

                    <div class="view-project-revealed" style="margin: 10px 0;">
                        <h4><i class="fas fa-lock-open"></i> Your Private Idea Blueprint (Only you and accepted partners can see this)</h4>
                        <p>${escapeHtml(p.description)}</p>
                    </div>

                    <div class="project-card-tags">
                        ${p.skills.map(s => `<span class="project-tag">${escapeHtml(s)}</span>`).join('')}
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; pt:10px; border-top:1px solid var(--border-light);">
                        <div style="display:flex; gap:16px; font-size:0.84rem; color:var(--text-muted);">
                            <span><i class="fas fa-inbox"></i> ${pendingReqs.length} Pending Proposal${pendingReqs.length !== 1 ? 's' : ''}</span>
                            <span><i class="fas fa-handshake"></i> ${acceptedPartners.length} Active Partner${acceptedPartners.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="my-project-actions">
                            ${acceptedPartners.length > 0 ? `
                                <button class="btn btn-success btn-sm" onclick="openCollaborationRoom('${p.id}')">
                                    <i class="fas fa-comments"></i> Partner Chat & Workspace
                                </button>
                            ` : ''}
                            <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        if (myPartnered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-handshake"></i>
                    <h3>No active partnerships yet</h3>
                    <p>Discover projects and send partnership proposals to unlock shared blueprints!</p>
                    <button class="btn btn-primary" onclick="showPage('discover')">
                        <i class="fas fa-compass"></i> Discover Projects
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = myPartnered.map(req => {
            const project = db.projects.find(p => p.id === req.projectId);
            if (!project) return '';

            const partnerId = req.fromUserId === user.id ? req.toUserId : req.fromUserId;
            const partner = db.users.find(u => u.id === partnerId);
            if (!partner) return '';

            return `
                <div class="my-project-item" style="border-left: 4px solid var(--secondary);">
                    <div class="my-project-item-header">
                        <div>
                            <h3>${escapeHtml(project.title)}</h3>
                            <span style="font-size: 0.82rem; color: var(--text-muted);">
                                Matched with <strong>${escapeHtml(partner.name)}</strong> (${escapeHtml(partner.department)} • ${escapeHtml(partner.university)})
                            </span>
                        </div>
                        <span class="request-accepted request-status"><i class="fas fa-check-circle"></i> Partnered</span>
                    </div>

                    <div class="view-project-revealed" style="margin: 12px 0;">
                        <h4><i class="fas fa-unlock-alt"></i> Unlocked Full Project Idea & Blueprint</h4>
                        <p>${escapeHtml(project.description)}</p>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
                        <div class="project-card-tags">
                            ${project.skills.map(s => `<span class="project-tag">${escapeHtml(s)}</span>`).join('')}
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="openCollaborationRoom('${project.id}')">
                            <i class="fas fa-comments"></i> Open Collaboration Room
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function switchMyProjectTab(tab, btn) {
    document.querySelectorAll('.my-projects-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderMyProjects(tab);
}

async function deleteProject(projectId) {
    if (!confirm('Delete this project and its collaboration requests? This cannot be undone.')) return;
    try {
        await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        await refreshBackendState();
        showToast('Project deleted');
        if (currentPage === 'feed') renderFeed(); else if (currentPage === 'discover') renderDiscover(); else renderMyProjects('posted');
    } catch (error) { showToast(error.message || 'Could not delete this project.'); }
}

// ===== REQUESTS =====
let requestTab = 'received';

function renderRequests(tab) {
    if (!requireAuth()) return;
    requestTab = tab || requestTab;

    const db = getDB();
    const user = getCurrentUser();
    const container = document.getElementById('requestsList');

    const received = db.requests.filter(r => r.toUserId === user.id);
    const sent = db.requests.filter(r => r.fromUserId === user.id);

    document.getElementById('receivedCount').textContent = received.filter(r => r.status === 'pending').length;
    document.getElementById('sentCount').textContent = sent.length;

    const items = requestTab === 'received' ? received : sent;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>No requests in this view</h3>
                <p>${requestTab === 'received' ? 'When students propose collaborating on your project, their proposals will appear here.' : 'Browse projects and send proposals to connect with project creators.'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(req => {
        const project = db.projects.find(p => p.id === req.projectId);
        if (!project) return '';

        const otherUserId = requestTab === 'received' ? req.fromUserId : req.toUserId;
        const otherUser = db.users.find(u => u.id === otherUserId);
        if (!otherUser) return '';

        let statusHtml = '';
        let actionsHtml = '';

        if (req.status === 'pending') {
            if (requestTab === 'received') {
                actionsHtml = `
                    <div class="request-card-actions">
                        <button class="btn btn-success btn-sm" onclick="handleRequestAction('${req.id}', 'accepted')">
                            <i class="fas fa-check"></i> Accept & Reveal Idea
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="handleRequestAction('${req.id}', 'declined')">
                            <i class="fas fa-times"></i> Decline
                        </button>
                    </div>
                `;
            } else {
                statusHtml = '<span class="request-pending request-status"><i class="fas fa-clock"></i> Pending Review</span>';
            }
        } else if (req.status === 'accepted') {
            statusHtml = '<span class="request-accepted request-status"><i class="fas fa-check-circle"></i> Partnership Accepted</span>';
            actionsHtml = `
                <button class="btn btn-outline btn-sm" onclick="openCollaborationRoom('${project.id}')">
                    <i class="fas fa-comments"></i> Enter Collaboration Room
                </button>
            `;
        } else {
            statusHtml = '<span class="request-declined request-status"><i class="fas fa-times-circle"></i> Declined</span>';
        }

        return `
            <div class="request-card">
                <div class="request-card-header">
                    <div class="request-card-avatar">${escapeHtml(getInitials(otherUser.name))}</div>
                    <div class="request-card-info" style="flex:1;">
                        <h4>${escapeHtml(otherUser.name)}</h4>
                        <p>${escapeHtml(otherUser.department)} • ${escapeHtml(otherUser.year)} • ${escapeHtml(otherUser.university)}</p>
                        <p style="font-size:0.75rem; color:var(--text-muted);">
                            Skills: ${escapeHtml(otherUser.skills.join(', '))}
                        </p>
                    </div>
                    ${statusHtml}
                </div>
                <p class="request-card-project">
                    ${requestTab === 'received' ? 'Proposed to partner on' : 'You proposed to partner on'}:
                    <strong>"${escapeHtml(project.title)}"</strong>
                </p>
                <div class="request-card-message">"${escapeHtml(req.message)}"</div>
                ${actionsHtml}
                <div style="text-align:right; font-size:0.72rem; color:var(--text-muted); margin-top:6px;">
                    ${timeAgo(req.createdAt)}
                </div>
            </div>
        `;
    }).join('');
}

function switchRequestTab(tab, btn) {
    document.querySelectorAll('.requests-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderRequests(tab);
}

async function handleRequestAction(requestId, action) {
    try {
        await apiRequest(`/api/requests/${encodeURIComponent(requestId)}`, { method: 'PUT', body: JSON.stringify({ status: action }) });
        await refreshBackendState();
        renderRequests('received');
        updateRequestBadge();
        showToast(action === 'accepted' ? 'Partnership accepted! The project blueprint is unlocked.' : 'Proposal declined');
    } catch (error) { showToast(error.message || 'Could not update this request.'); }
}

// ===== INTERACTIVE COLLABORATION ROOM & LIVE CHAT =====
async function openCollaborationRoom(projectId) {
    if (!requireAuth()) return;
    const db = getDB();
    const user = getCurrentUser();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) { showToast('Project is not available. Refresh and try again.'); return; }
    activeCollabProjectId = projectId;
    const partnerReq = db.requests.find(r => r.projectId === projectId && r.status === 'accepted' && (r.fromUserId === user.id || r.toUserId === user.id));
    const isOwner = project.userId === user.id;
    if (!isOwner && !partnerReq) { showToast('Collaboration room is available after a partnership is accepted.'); return; }
    const partnerId = isOwner ? partnerReq?.fromUserId : project.userId;
    const partner = db.users.find(u => u.id === partnerId);
    document.getElementById('collabProjectTitle').textContent = project.title;
    document.getElementById('collabPartnerInfo').innerHTML = `Collaborating with: <strong>${escapeHtml(partner ? partner.name : 'your partner')}</strong> ${partner ? `(${escapeHtml(partner.department)})` : ''}`;
    document.getElementById('collabProjectDescription').textContent = project.description || 'Project blueprint is available to approved partners.';
    try {
        const messages = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/messages`);
        db.collaborationMessages = (messages || []).map(msg => ({
            id: String(msg._id), projectId, senderId: String(msg.sender?._id || msg.sender),
            senderName: msg.sender?.name || 'Collaborator', text: msg.message, timestamp: msg.createdAt
        }));
        saveDB(db);
    } catch (error) { showToast(error.message || 'Could not load collaboration messages.'); }
    renderChatMessages();
    document.getElementById('collaborationModal').classList.remove('hidden');
}

function renderChatMessages() {
    const db = getDB();
    const user = getCurrentUser();
    const container = document.getElementById('chatMessagesContainer');
    if (!container || !activeCollabProjectId) return;
    const messages = (db.collaborationMessages || []).filter(m => m.projectId === activeCollabProjectId);
    if (messages.length === 0) {
        container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:30px 10px;font-size:.85rem"><i class="fas fa-handshake" style="font-size:1.8rem;margin-bottom:8px;display:block"></i>Start your collaboration! Say hello and outline your first milestones.</div>`;
        return;
    }
    container.innerHTML = messages.map(msg => {
        const isMe = msg.senderId === user.id;
        return `<div class="chat-bubble ${isMe ? 'chat-bubble-me' : 'chat-bubble-partner'}"><div class="chat-bubble-sender">${escapeHtml(isMe ? 'You' : msg.senderName)}</div><div>${escapeHtml(msg.text)}</div><div class="chat-bubble-time">${timeAgo(msg.timestamp)}</div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

async function handleSendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chatInputMessage');
    const text = input.value.trim();
    if (!text || !activeCollabProjectId) return;
    try {
        const msg = await apiRequest(`/api/projects/${encodeURIComponent(activeCollabProjectId)}/messages`, { method: 'POST', body: JSON.stringify({ message: text }) });
        const db = getDB();
        if (!Array.isArray(db.collaborationMessages)) db.collaborationMessages = [];
        db.collaborationMessages.push({ id: String(msg._id), projectId: activeCollabProjectId, senderId: String(msg.sender?._id || db.currentUserId), senderName: msg.sender?.name || getCurrentUser()?.name || 'You', text: msg.message, timestamp: msg.createdAt });
        saveDB(db);
        input.value = '';
        renderChatMessages();
    } catch (error) { showToast(error.message || 'Could not send the message.'); }
}

function toggleMilestone(checkbox) {
    const total = document.querySelectorAll('.milestone-item input').length;
    const checked = document.querySelectorAll('.milestone-item input:checked').length;
    const progressEl = document.getElementById('milestoneProgress');
    if (progressEl) {
        progressEl.textContent = `${checked}/${total} Done`;
    }
}

// ===== POST PROJECT =====
function openPostModal() {
    if (!requireAuth()) return;
    document.getElementById('postProjectModal').classList.remove('hidden');
    document.getElementById('projectTitle').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectDept').value = '';
    document.getElementById('projectDifficulty').value = '';
    document.getElementById('projectSkills').value = '';
    document.getElementById('projectTeamSize').value = '';
    document.getElementById('projectStatus').value = 'Looking for Partners';
}

async function handlePostProject(e) {
    e.preventDefault();
    const payload = {
        title: document.getElementById('projectTitle').value.trim(),
        description: document.getElementById('projectDescription').value.trim(),
        department: document.getElementById('projectDept').value,
        difficulty: document.getElementById('projectDifficulty').value,
        skills: document.getElementById('projectSkills').value.split(',').map(s => s.trim()).filter(Boolean),
        teamSize: document.getElementById('projectTeamSize').value,
        status: document.getElementById('projectStatus').value
    };
    try {
        await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
        await refreshBackendState();
        closeModal('postProjectModal');
        showToast('Project posted to ProjectBuddy!');
        if (currentPage === 'feed') renderFeed(); else if (currentPage === 'discover') renderDiscover(); else if (currentPage === 'my-projects') renderMyProjects('posted');
    } catch (error) { showToast(error.message || 'Could not post the project.'); }
}

// ===== VIEW PROJECT MODAL =====
function viewProject(projectId) {
    const db = getDB();
    const user = getCurrentUser();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) return;

    const author = db.users.find(u => u.id === project.userId);
    if (!author) return;

    const isOwner = user && project.userId === user.id;
    const isPartner = user && db.requests.find(r =>
        r.projectId === project.id &&
        r.status === 'accepted' &&
        (r.fromUserId === user.id || r.toUserId === user.id)
    );
    const hasRequested = user && db.requests.find(r => r.fromUserId === user.id && r.projectId === project.id);
    const canSeeIdea = isOwner || isPartner;

    let blueprintSection = '';
    if (canSeeIdea) {
        blueprintSection = `
            <div class="view-project-revealed">
                <h4><i class="fas fa-unlock-alt"></i> Full Project Blueprint ${isOwner ? '(Creator View)' : '(Partner View Unlocked)'}</h4>
                <p>${escapeHtml(project.description)}</p>
            </div>
        `;
    } else {
        blueprintSection = `
            <div class="view-project-hidden-box">
                <i class="fas fa-shield-alt"></i>
                <h4>Idea Blueprint is Protected</h4>
                <p>The detailed specifications and methodology are shielded to protect student intellectual property. Submit a partnership proposal to unlock the full blueprint!</p>
            </div>
        `;
    }

    let actionBtn = '';
    if (user && !isOwner && !isPartner && !hasRequested) {
        actionBtn = `
            <button class="btn btn-primary btn-full" onclick="closeModal('viewProjectModal'); openRequestModal('${project.id}');" style="margin-top:16px;">
                <i class="fas fa-handshake"></i> Send Partnership Proposal
            </button>
        `;
    } else if (isPartner) {
        actionBtn = `
            <button class="btn btn-success btn-full" onclick="closeModal('viewProjectModal'); openCollaborationRoom('${project.id}');" style="margin-top:16px;">
                <i class="fas fa-comments"></i> Enter Partner Collaboration Room
            </button>
        `;
    }

    document.getElementById('viewProjectContent').innerHTML = `
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px;">
            <div class="project-card-avatar" style="width:52px; height:52px; font-size:1.1rem;">
                ${escapeHtml(getInitials(author.name))}
            </div>
            <div>
                <h4 style="font-size:1.05rem;">${escapeHtml(author.name)}</h4>
                <p style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(author.department)} • ${escapeHtml(author.year)} • ${escapeHtml(author.university)}</p>
            </div>
        </div>
        <h2 class="view-project-title">${escapeHtml(project.title)}</h2>
        <div class="view-project-meta">
            <span><i class="fas fa-tag"></i> ${escapeHtml(project.department)}</span>
            <span><i class="fas fa-layer-group"></i> ${escapeHtml(project.difficulty)}</span>
            <span><i class="fas fa-users"></i> ${escapeHtml(project.teamSize)}</span>
            <span><i class="fas fa-clock"></i> ${timeAgo(project.createdAt)}</span>
        </div>
        ${blueprintSection}
        <div style="margin-top:16px;">
            <h4 style="margin-bottom:8px; font-size:0.95rem;">Required Tech Stack</h4>
            <div class="project-card-tags">
                ${project.skills.map(s => `<span class="project-tag">${escapeHtml(s)}</span>`).join('')}
            </div>
        </div>
        ${actionBtn}
    `;

    document.getElementById('viewProjectModal').classList.remove('hidden');
}

// ===== SEND REQUEST =====
function openRequestModal(projectId) {
    if (!requireAuth()) return;

    const db = getDB();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) return;

    if (project.userId === db.currentUserId) {
        showToast('You cannot send a partnership proposal to your own project!');
        return;
    }

    document.getElementById('requestProjectId').value = projectId;
    document.getElementById('requestModalTitle').textContent = `Propose partnership on "${project.title}"`;
    document.getElementById('requestMessage').value = '';
    document.getElementById('requestModal').classList.remove('hidden');
}

async function handleSendRequest(e) {
    e.preventDefault();
    const projectId = document.getElementById('requestProjectId').value;
    const message = document.getElementById('requestMessage').value.trim();
    try {
        await apiRequest('/api/requests', { method: 'POST', body: JSON.stringify({ projectId, message }) });
        await refreshBackendState();
        closeModal('requestModal');
        showToast('Partnership proposal sent!');
        if (currentPage === 'feed') renderFeed(); else if (currentPage === 'discover') renderDiscover();
    } catch (error) { showToast(error.message || 'Could not send your proposal.'); }
}

// ===== PROFILE =====
function renderProfile() {
    if (!requireAuth()) return;
    const db = getDB();
    const user = getCurrentUser();

    document.getElementById('profileAvatar').textContent = getInitials(user.name);
    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileDept').textContent = `${user.department} • ${user.year}`;
    document.getElementById('profileUni').textContent = user.university;
    document.getElementById('profileBio').textContent = user.bio;
    document.getElementById('profileAnonToken').textContent = user.anonToken || 'STU_NEW';

    document.getElementById('profileSkills').innerHTML =
        (user.skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('');

    const myProjects = db.projects.filter(p => p.userId === user.id);
    const myPartners = db.requests.filter(r =>
        (r.fromUserId === user.id || r.toUserId === user.id) && r.status === 'accepted'
    ).length;
    const sentReqs = db.requests.filter(r => r.fromUserId === user.id).length;

    document.getElementById('pStatProjects').textContent = myProjects.length;
    document.getElementById('pStatPartners').textContent = myPartners;
    document.getElementById('pStatRequests').textContent = sentReqs;

    const container = document.getElementById('profileProjects');
    if (myProjects.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No projects hosted yet.</p>';
    } else {
        container.innerHTML = myProjects.map(p => `
            <div class="profile-project-item">
                <h4>${escapeHtml(p.title)}</h4>
                <p>${escapeHtml(p.department)} • ${escapeHtml(p.difficulty)} • <span class="status-badge-active">${escapeHtml(p.status)}</span></p>
            </div>
        `).join('');
    }
}

function openEditProfileModal() {
    const user = getCurrentUser();
    if (!user) return;

    document.getElementById('editName').value = user.name;
    document.getElementById('editUniversity').value = user.university;
    document.getElementById('editDepartment').value = user.department;
    document.getElementById('editYear').value = user.year;
    document.getElementById('editSkills').value = (user.skills || []).join(', ');
    document.getElementById('editBio').value = user.bio;

    document.getElementById('editProfileModal').classList.remove('hidden');
}

async function handleEditProfile(e) {
    e.preventDefault();
    const db = getDB();
    const user = db.users.find(u => u.id === db.currentUserId);
    if (!user) return;
    const payload = {
        name: document.getElementById('editName').value.trim(),
        university: document.getElementById('editUniversity').value.trim(),
        department: document.getElementById('editDepartment').value,
        year: document.getElementById('editYear').value,
        skills: document.getElementById('editSkills').value.split(',').map(s => s.trim()).filter(Boolean),
        bio: document.getElementById('editBio').value.trim()
    };
    try {
        const updated = await apiRequest(`/api/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        const mapped = mapBackendUser(updated);
        db.users = db.users.filter(u => u.id !== user.id);
        db.users.push(mapped);
        db.currentUserId = mapped.id;
        saveDB(db);
        closeModal('editProfileModal');
        renderProfile(); updateNavState(true);
        showToast('Profile updated successfully!');
    } catch (error) { showToast(error.message || 'Could not update your profile.'); }
}

// ===== MODAL UTILITIES =====
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === this) this.classList.add('hidden');
    });
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    }
});

// ===== TOAST NOTIFICATIONS =====
function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMessage');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async function() {
    const db = getDB();
    loadLatestAnnouncement();
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) {
        try {
            const liveDb = await refreshBackendState();
            updateNavState(true);
            showPage('feed');
            return;
        } catch (error) {
            sessionStorage.removeItem(TOKEN_KEY);
            const cleanDb = getDB(); cleanDb.currentUserId = null; saveDB(cleanDb);
        }
    }
    updateNavState(false);
    showPage('landing');
});
