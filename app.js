/* ============================================================
   EDUBEMI — app.js
   Vanilla JS + Supabase. Zero build. See bottom of file for
   suggested SQL schema / RLS policies / storage buckets.
   ============================================================ */

// ===============================
// SUPABASE CONFIGURATION
// Replace these with your project values.
// ===============================
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const CONFIG_OK = SUPABASE_URL && SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes("YOUR_SUPABASE_URL") &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");

// ===============================
// SUPABASE INITIALIZATION
// ===============================
let sb = null;
if (CONFIG_OK && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

// ===============================
// STATE
// ===============================
const state = {
  user: null,
  profile: null,
  guardianCount: 0,
  selectedCourseId: null,
  feesMap: {},        // class -> {monthly_fee, id}
  coursesCache: [],
  settings: {
    site_name: "EDUBEMI",
    slogan: "\"Knowledge lights the path to tomorrow.\"",
    phone: "PHONE_PLACEHOLDER",
    email: "EMAIL_PLACEHOLDER",
    address: "X, X, X",
    maps_url: "GOOGLE_MAPS_URL_HERE"
  },
  currentAdminTab: "overview"
};

// ===============================
// UI HELPERS
// ===============================
function $(id) { return document.getElementById(id); }
function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function formatDate(d) {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch (e) { return d; }
}

let toastTimer = null;
function showToast(message, type) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm text-white shadow-lg max-w-[90vw] text-center " +
    (type === "error" ? "bg-red-600" : type === "success" ? "bg-green-600" : "bg-gray-800");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

function loadingHtml(msg) {
  return `<div class="flex items-center gap-2 text-gray-400 text-sm py-3"><span class="spinner"></span>${escapeHtml(msg || "Loading...")}</div>`;
}
function emptyHtml(msg) {
  return `<p class="text-gray-400 text-sm py-3">${escapeHtml(msg || "Nothing to show yet.")}</p>`;
}
function errorHtml(msg) {
  return `<p class="text-red-600 text-sm py-3">⚠ ${escapeHtml(msg || "Something went wrong.")}</p>`;
}

function openModal(title, bodyHtml, onMount) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  const dlg = $("formModal");
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
  if (typeof onMount === "function") onMount($("modalBody"));
}
function closeModal() {
  const dlg = $("formModal");
  if (typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
}

// ===============================
// NAVIGATION
// ===============================
const VIEWS = ["home", "login", "signup", "notice", "admission", "leaderboard", "location", "about", "contact", "admin"];

function showView(view, pushState) {
  if (!VIEWS.includes(view)) view = "home";

  if (view === "admin" && !(state.profile && state.profile.role === "admin")) {
    showToast("Access denied. Admins only.", "error");
    view = "home";
  }

  VIEWS.forEach(v => {
    const el = $("view-" + v);
    if (el) el.classList.toggle("hidden", v !== view);
  });

  $("mainNav").classList.add("hidden");
  $("menuToggle").setAttribute("aria-expanded", "false");

  if (pushState !== false) {
    history.pushState({ view }, "", "#" + view);
  }
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  // Lazy load data per view
  if (view === "notice") loadNotices("noticeList", 20);
  if (view === "leaderboard") loadLeaderboard("leaderboardList", true);
  if (view === "admission") initAdmissionView();
  if (view === "admin") initAdminView();
}

function initNavigation() {
  qsa("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.getAttribute("data-view")));
  });

  $("menuToggle").addEventListener("click", () => {
    const nav = $("mainNav");
    const willShow = nav.classList.contains("hidden");
    nav.classList.toggle("hidden");
    $("menuToggle").setAttribute("aria-expanded", String(willShow));
  });

  window.addEventListener("popstate", (e) => {
    const view = (e.state && e.state.view) || location.hash.replace("#", "") || "home";
    showView(view, false);
  });

  $("modalCloseBtn").addEventListener("click", closeModal);

  const startView = location.hash.replace("#", "") || "home";
  showView(startView, false);
}

// ===============================
// AUTHENTICATION
// ===============================
async function handleSignup(e) {
  e.preventDefault();
  const errEl = $("signupError"); const okEl = $("signupSuccess");
  errEl.classList.add("hidden"); okEl.classList.add("hidden");
  if (!sb) { errEl.textContent = "Backend not configured yet."; errEl.classList.remove("hidden"); return; }

  const fullName = $("signupName").value.trim();
  const profession = $("signupProfession").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;
  const role = $("signupRole").value; // student | teacher | parent only (admin not offered in UI)

  if (!fullName || !email || password.length < 6) {
    errEl.textContent = "Please fill all required fields (password min 6 characters).";
    errEl.classList.remove("hidden");
    return;
  }
  if (!["student", "teacher", "parent"].includes(role)) {
    errEl.textContent = "Invalid role selected.";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = $("signupBtn"); btn.disabled = true; btn.textContent = "Creating account...";
  try {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;

    if (data.user) {
      const { error: profErr } = await sb.from("profiles").insert({
        id: data.user.id, full_name: fullName, profession, role
      });
      if (profErr) throw profErr;
    }

    if (data.session) {
      okEl.textContent = "Account created successfully!";
      okEl.classList.remove("hidden");
      await loadSessionProfile();
      showToast("Welcome to EDUBEMI!", "success");
      showView("home");
    } else {
      okEl.textContent = "Account created! Please check your email to confirm, then login.";
      okEl.classList.remove("hidden");
      setTimeout(() => showView("login"), 1800);
    }
    qs("#signupForm").reset();
  } catch (err) {
    errEl.textContent = err.message || "Signup failed.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Sign Up";
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const errEl = $("loginError");
  errEl.classList.add("hidden");
  if (!sb) { errEl.textContent = "Backend not configured yet."; errEl.classList.remove("hidden"); return; }

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const btn = $("loginBtn"); btn.disabled = true; btn.textContent = "Logging in...";
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await loadSessionProfile();
    qs("#loginForm").reset();
    showToast("Logged in successfully.", "success");
    showView("home");
  } catch (err) {
    errEl.textContent = err.message || "Login failed.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Login";
  }
}

async function handleLogout() {
  if (!sb) return;
  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  state.user = null; state.profile = null;
  updateAuthUI();
  showToast("Logged out.", "success");
  showView("home");
}

// ===============================
// SESSION MANAGEMENT
// ===============================
async function loadSessionProfile() {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  state.user = session ? session.user : null;
  state.profile = null;
  if (state.user) {
    try {
      const { data, error } = await sb.from("profiles")
        .select("id, full_name, role, profession")
        .eq("id", state.user.id)
        .single();
      if (!error) state.profile = data;
    } catch (e) { /* profile may not exist yet */ }
  }
  updateAuthUI();
}

function updateAuthUI() {
  const loggedIn = !!state.user;
  $("navLogin").classList.toggle("hidden", loggedIn);
  $("navSignupLink").classList.toggle("hidden", loggedIn);
  $("navLogout").classList.toggle("hidden", !loggedIn);
  $("navAdmin").classList.toggle("hidden", !(state.profile && state.profile.role === "admin"));
  $("myAdmissionsWrap").classList.toggle("hidden", !loggedIn);
  if (loggedIn) loadMyAdmissions();
}

function initAuth() {
  $("loginForm").addEventListener("submit", handleLogin);
  $("signupForm").addEventListener("submit", handleSignup);
  $("navLogout").addEventListener("click", handleLogout);

  if (sb) {
    sb.auth.onAuthStateChange((_event, _session) => {
      loadSessionProfile();
    });
  }
}

// ===============================
// SETTINGS (site_settings table)
// ===============================
async function loadSiteSettings() {
  applySettingsToDom(); // apply placeholders immediately
  if (!sb) return;
  try {
    const { data, error } = await sb.from("site_settings")
      .select("site_name, slogan, phone, email, address, maps_url")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) {
      state.settings = { ...state.settings, ...data };
      applySettingsToDom();
    }
  } catch (e) { /* keep placeholders */ }
}

function applySettingsToDom() {
  const s = state.settings;
  $("homeSiteName").textContent = s.site_name;
  $("homeSlogan").textContent = s.slogan;
  $("homeAddress").textContent = s.address;
  $("homeMapsBtn").href = s.maps_url;
  $("homePhone").textContent = s.phone;
  $("homePhone").href = "tel:" + s.phone;
  $("homeEmail").textContent = s.email;
  $("homeEmail").href = "mailto:" + s.email;

  $("locationName").textContent = s.site_name;
  $("locationAddress").textContent = s.address;
  $("locationMapsBtn").href = s.maps_url;

  $("contactPhone").textContent = s.phone;
  $("contactPhone").href = "tel:" + s.phone;
  $("contactEmail").textContent = s.email;
  $("contactEmail").href = "mailto:" + s.email;
  $("contactAddress").textContent = s.address;
}

async function saveSiteSettings(e) {
  e.preventDefault();
  if (!sb) { showToast("Backend not configured.", "error"); return; }
  const payload = {
    id: 1,
    site_name: $("setSiteName").value.trim() || "EDUBEMI",
    slogan: $("setSlogan").value.trim(),
    phone: $("setPhone").value.trim(),
    email: $("setEmail").value.trim(),
    address: $("setAddress").value.trim(),
    maps_url: $("setMapsUrl").value.trim()
  };
  const msg = $("settingsMsg");
  try {
    const { error } = await sb.from("site_settings").upsert(payload);
    if (error) throw error;
    state.settings = { ...state.settings, ...payload };
    applySettingsToDom();
    msg.textContent = "Settings saved."; msg.className = "text-sm text-green-600"; msg.classList.remove("hidden");
    showToast("Settings updated.", "success");
  } catch (err) {
    msg.textContent = err.message || "Failed to save settings.";
    msg.className = "text-sm text-red-600"; msg.classList.remove("hidden");
  }
}

function fillSettingsForm() {
  const s = state.settings;
  $("setSiteName").value = s.site_name || "";
  $("setSlogan").value = s.slogan || "";
  $("setPhone").value = s.phone || "";
  $("setEmail").value = s.email || "";
  $("setAddress").value = s.address || "";
  $("setMapsUrl").value = s.maps_url || "";
}

// ===============================
// NOTICES
// ===============================
async function loadNotices(targetId, limit) {
  const el = $(targetId);
  el.innerHTML = loadingHtml("Loading notices...");
  if (!sb) { el.innerHTML = errorHtml("Backend not configured."); return; }
  try {
    const { data, error } = await sb.from("notices")
      .select("id, title, description, image_url, created_at")
      .order("created_at", { ascending: false })
      .limit(limit || 5);
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No notices yet."); return; }
    el.innerHTML = data.map(n => `
      <div class="border border-gray-200 rounded-lg p-3 bg-white">
        ${n.image_url ? `<img src="${escapeHtml(n.image_url)}" alt="" loading="lazy" class="w-full max-h-40 object-cover rounded mb-2">` : ""}
        <p class="font-semibold text-sm">${escapeHtml(n.title)}</p>
        <p class="text-xs text-gray-600 mt-1">${escapeHtml(n.description || "")}</p>
        <p class="text-[11px] text-gray-400 mt-1">${formatDate(n.created_at)}</p>
      </div>`).join("");
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load notices.");
  }
}

// ===============================
// LEADERBOARD
// ===============================
function renderAvatar(name, url) {
  if (url) return `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy" class="w-10 h-10 rounded-full object-cover flex-shrink-0">`;
  const initials = (name || "?").trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return `<div class="avatar-default">${escapeHtml(initials)}</div>`;
}

async function loadLeaderboard(targetId, full) {
  const el = $(targetId);
  el.innerHTML = loadingHtml("Loading leaderboard...");
  if (!sb) { el.innerHTML = errorHtml("Backend not configured."); return; }
  try {
    const { data, error } = await sb.from("leaderboard")
      .select("id, student_name, photo_url, class, percentage, exam_date, week_identifier")
      .order("percentage", { ascending: false })
      .limit(5);
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No leaderboard entries yet."); return; }
    el.innerHTML = data.map((s, i) => `
      <div class="flex items-center gap-3 border border-gray-200 rounded-lg p-3 bg-white">
        <span class="font-bold text-indigo-600 w-5 text-center">${i + 1}</span>
        ${renderAvatar(s.student_name, s.photo_url)}
        <div class="min-w-0 flex-1">
          <p class="font-medium text-sm truncate">${escapeHtml(s.student_name)}</p>
          <p class="text-xs text-gray-500">${escapeHtml(s.class || "")} ${full ? "· " + formatDate(s.exam_date) : ""}</p>
        </div>
        <span class="font-semibold text-sm text-green-600">${s.percentage}%</span>
      </div>`).join("");
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load leaderboard.");
  }
}

// ===============================
// FEES / CLASSES (for admission dropdown)
// ===============================
async function loadClassesForAdmission() {
  const sel = $("studentClass");
  if (!sb) { sel.innerHTML = `<option value="">Backend not configured</option>`; return; }
  try {
    const { data, error } = await sb.from("fees")
      .select("id, class, monthly_fee")
      .eq("active", true)
      .order("class", { ascending: true });
    if (error) throw error;
    state.feesMap = {};
    if (!data || data.length === 0) {
      sel.innerHTML = `<option value="">No classes available</option>`;
      return;
    }
    data.forEach(f => { state.feesMap[f.class] = f.monthly_fee; });
    sel.innerHTML = `<option value="">Select class</option>` +
      data.map(f => `<option value="${escapeHtml(f.class)}">${escapeHtml(f.class)}</option>`).join("");
  } catch (err) {
    sel.innerHTML = `<option value="">Failed to load classes</option>`;
  }
}

function updateMonthlyFeePreview() {
  const cls = $("studentClass").value;
  const feeEl = $("monthlyFeeAmount");
  if (!cls) { feeEl.textContent = "Select a class above"; return; }
  const fee = state.feesMap[cls];
  feeEl.textContent = (fee !== undefined) ? ("₦" + Number(fee).toLocaleString()) : "Fee not set for this class";
}

// ===============================
// COURSES
// ===============================
async function loadCoursesForAdmission() {
  const el = $("courseListContainer");
  el.innerHTML = loadingHtml("Loading courses...");
  if (!sb) { el.innerHTML = errorHtml("Backend not configured."); return; }
  try {
    const { data, error } = await sb.from("courses")
      .select("id, name, description, fee")
      .eq("active", true)
      .order("name", { ascending: true });
    if (error) throw error;
    state.coursesCache = data || [];
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No active courses available."); return; }
    el.innerHTML = data.map(c => `
      <div class="border rounded-lg p-3 course-card" data-id="${c.id}">
        <p class="font-semibold text-sm">${escapeHtml(c.name)}</p>
        <p class="text-xs text-gray-500 mt-1">${escapeHtml(c.description || "")}</p>
        <p class="text-sm font-semibold text-indigo-600 mt-1">₦${Number(c.fee).toLocaleString()}</p>
        <button type="button" class="select-course-btn btn-secondary mt-2 text-xs" data-id="${c.id}">Select</button>
      </div>`).join("");
    qsa(".select-course-btn", el).forEach(btn => {
      btn.addEventListener("click", () => {
        state.selectedCourseId = btn.getAttribute("data-id");
        qsa(".course-card", el).forEach(card => card.classList.remove("ring-2", "ring-indigo-500"));
        btn.closest(".course-card").classList.add("ring-2", "ring-indigo-500");
        qsa(".select-course-btn", el).forEach(b => b.textContent = "Select");
        btn.textContent = "Selected ✓";
      });
    });
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load courses.");
  }
}

// ===============================
// ADMISSION
// ===============================
let admissionViewInitialized = false;

function guardianRowHtml(index) {
  return `
    <div class="guardian-row grid grid-cols-2 gap-2" data-index="${index}">
      <div>
        <label class="block text-xs font-medium mb-1" for="guardianName${index}">Guardian Name</label>
        <input type="text" id="guardianName${index}" class="form-input guardian-name" ${index === 0 ? "required" : ""}>
      </div>
      <div>
        <label class="block text-xs font-medium mb-1" for="guardianPhone${index}">Guardian Phone</label>
        <input type="tel" id="guardianPhone${index}" class="form-input guardian-phone" ${index === 0 ? "required" : ""}>
      </div>
    </div>`;
}

function addGuardianRow() {
  if (state.guardianCount >= 3) { showToast("Maximum 3 guardians allowed.", "error"); return; }
  const container = $("guardiansContainer");
  container.insertAdjacentHTML("beforeend", guardianRowHtml(state.guardianCount));
  state.guardianCount++;
  $("addGuardianBtn").disabled = state.guardianCount >= 3;
  $("addGuardianBtn").classList.toggle("opacity-50", state.guardianCount >= 3);
}

function resetGuardianRows() {
  $("guardiansContainer").innerHTML = "";
  state.guardianCount = 0;
  addGuardianRow();
}

function initAdmissionView() {
  if (admissionViewInitialized) return;
  admissionViewInitialized = true;

  resetGuardianRows();
  $("addGuardianBtn").addEventListener("click", addGuardianRow);

  qsa('input[name="studyType"]').forEach(r => r.addEventListener("change", onStudyTypeChange));
  $("studentClass").addEventListener("change", updateMonthlyFeePreview);

  loadClassesForAdmission().then(updateMonthlyFeePreview);
  loadCoursesForAdmission();

  $("admissionForm").addEventListener("submit", submitAdmission);
}

function onStudyTypeChange() {
  const type = qs('input[name="studyType"]:checked').value;
  $("monthlyFeeSection").classList.toggle("hidden", type !== "monthly");
  $("courseSection").classList.toggle("hidden", type !== "course");
}

function validatePhone(phone) {
  return /^[0-9+\-\s]{7,15}$/.test(phone.trim());
}

async function submitAdmission(e) {
  e.preventDefault();
  const errEl = $("admissionError"); const okEl = $("admissionSuccess");
  errEl.classList.add("hidden"); okEl.classList.add("hidden");

  const studentName = $("studentName").value.trim();
  const studentAddress = $("studentAddress").value.trim();
  const studentClass = $("studentClass").value;
  const studentPhone = $("studentPhone").value.trim();
  const studyType = qs('input[name="studyType"]:checked').value;

  const guardians = qsa(".guardian-row").map(row => ({
    guardian_name: qs(".guardian-name", row).value.trim(),
    guardian_phone: qs(".guardian-phone", row).value.trim()
  })).filter(g => g.guardian_name || g.guardian_phone);

  // Validation
  if (!studentName || !studentAddress || !studentClass || !studentPhone) {
    errEl.textContent = "Please fill all required student information fields.";
    errEl.classList.remove("hidden"); return;
  }
  if (!validatePhone(studentPhone)) {
    errEl.textContent = "Please enter a valid student phone number.";
    errEl.classList.remove("hidden"); return;
  }
  if (guardians.length === 0 || !guardians[0].guardian_name || !validatePhone(guardians[0].guardian_phone)) {
    errEl.textContent = "Please provide at least one valid guardian with name and phone.";
    errEl.classList.remove("hidden"); return;
  }
  for (const g of guardians) {
    if (g.guardian_phone && !validatePhone(g.guardian_phone)) {
      errEl.textContent = "One of the guardian phone numbers is invalid.";
      errEl.classList.remove("hidden"); return;
    }
  }
  if (studyType === "course" && !state.selectedCourseId) {
    errEl.textContent = "Please select a course.";
    errEl.classList.remove("hidden"); return;
  }

  if (!sb) { errEl.textContent = "Backend not configured yet."; errEl.classList.remove("hidden"); return; }

  const btn = $("admissionSubmitBtn"); btn.disabled = true; btn.textContent = "Submitting...";
  try {
    const admissionPayload = {
      user_id: state.user ? state.user.id : null,
      student_name: studentName,
      student_address: studentAddress,
      student_class: studentClass,
      student_phone: studentPhone,
      study_type: studyType,
      course_id: studyType === "course" ? state.selectedCourseId : null,
      status: "pending"
    };
    const { data: admission, error: admErr } = await sb.from("admissions")
      .insert(admissionPayload).select("id").single();
    if (admErr) throw admErr;

    const guardianRows = guardians.map(g => ({
      admission_id: admission.id,
      guardian_name: g.guardian_name,
      guardian_phone: g.guardian_phone
    }));
    const { error: gErr } = await sb.from("guardians").insert(guardianRows);
    if (gErr) throw gErr;

    okEl.textContent = "Your admission application has been submitted successfully. You will be informed about your admission status.";
    okEl.classList.remove("hidden");
    showToast("Admission submitted!", "success");
    qs("#admissionForm").reset();
    resetGuardianRows();
    state.selectedCourseId = null;
    onStudyTypeChange();
    updateMonthlyFeePreview();
    if (state.user) loadMyAdmissions();
  } catch (err) {
    errEl.textContent = err.message || "Failed to submit application.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Submit Application";
  }
}

async function loadMyAdmissions() {
  if (!sb || !state.user) return;
  const el = $("myAdmissions");
  el.innerHTML = loadingHtml("Loading your applications...");
  try {
    const { data, error } = await sb.from("admissions")
      .select("id, student_name, status, created_at")
      .eq("user_id", state.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("You have no admission applications yet."); return; }
    el.innerHTML = data.map(a => `
      <div class="flex items-center justify-between border border-gray-200 rounded-lg p-2 bg-white">
        <span>${escapeHtml(a.student_name)} <span class="text-gray-400 text-xs">(${formatDate(a.created_at)})</span></span>
        <span class="badge badge-${a.status}">${escapeHtml(a.status)}</span>
      </div>`).join("");
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load your applications.");
  }
}

// ===============================
// STORAGE (image uploads)
// ===============================
async function uploadFile(bucket, file, prefix) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("Only image files are allowed.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Image must be smaller than 2MB.");
  const path = `${prefix || "img"}-${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ===============================
// ADMIN
// ===============================
let adminViewInitialized = false;

function requireAdmin() {
  return !!(state.profile && state.profile.role === "admin");
}

function initAdminView() {
  if (!requireAdmin()) return;
  if (!adminViewInitialized) {
    adminViewInitialized = true;
    qsa(".admin-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => switchAdminTab(btn.getAttribute("data-tab")));
    });
    $("addCourseBtn").addEventListener("click", () => openCourseModal());
    $("addFeeBtn").addEventListener("click", () => openFeeModal());
    $("addNoticeBtn").addEventListener("click", () => openNoticeModal());
    $("addLeaderBtn").addEventListener("click", () => openLeaderModal());
    $("admissionFilterBtn").addEventListener("click", () => loadAdminAdmissions());
    $("settingsForm").addEventListener("submit", saveSiteSettings);
  }
  switchAdminTab(state.currentAdminTab);
}

function switchAdminTab(tab) {
  state.currentAdminTab = tab;
  qsa(".admintab").forEach(el => el.classList.add("hidden"));
  const target = $("admintab-" + tab);
  if (target) target.classList.remove("hidden");
  qsa(".admin-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === tab));

  if (tab === "overview") loadAdminOverview();
  if (tab === "admissions") loadAdminAdmissions();
  if (tab === "courses") loadAdminCourses();
  if (tab === "fees") loadAdminFees();
  if (tab === "notices") loadAdminNotices();
  if (tab === "leaderboard") loadAdminLeaderboard();
  if (tab === "users") loadAdminUsers();
  if (tab === "settings") fillSettingsForm();
}

async function countRows(table, filters) {
  let q = sb.from(table).select("id", { count: "exact", head: true });
  if (filters) Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function loadAdminOverview() {
  if (!sb) return;
  try {
    const [pending, approved, total, users, courses, notices] = await Promise.all([
      countRows("admissions", { status: "pending" }),
      countRows("admissions", { status: "approved" }),
      countRows("admissions"),
      countRows("profiles"),
      countRows("courses", { active: true }),
      countRows("notices")
    ]);
    $("statPending").textContent = pending;
    $("statApproved").textContent = approved;
    $("statTotal").textContent = total;
    $("statUsers").textContent = users;
    $("statCourses").textContent = courses;
    $("statNotices").textContent = notices;
    if (pending > 0) showToast(`New Admission Received — ${pending} pending application(s).`, "success");
  } catch (err) {
    showToast("Failed to load dashboard stats.", "error");
  }
}

// --- Admissions management ---
async function loadAdminAdmissions() {
  const el = $("admissionsTableWrap");
  el.innerHTML = loadingHtml("Loading admissions...");
  try {
    const search = $("admissionSearch").value.trim();
    const status = $("admissionFilterStatus").value;
    let q = sb.from("admissions")
      .select("id, student_name, student_class, student_phone, study_type, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (search) q = q.ilike("student_name", `%${search}%`);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No admissions found."); return; }
    el.innerHTML = `<table class="data-table"><thead><tr>
      <th>Student</th><th>Class</th><th>Phone</th><th>Type</th><th>Status</th><th>Date</th><th>Actions</th>
      </tr></thead><tbody>${data.map(a => `
      <tr>
        <td>${escapeHtml(a.student_name)}</td>
        <td>${escapeHtml(a.student_class)}</td>
        <td>${escapeHtml(a.student_phone)}</td>
        <td>${escapeHtml(a.study_type)}</td>
        <td><span class="badge badge-${a.status}">${escapeHtml(a.status)}</span></td>
        <td>${formatDate(a.created_at)}</td>
        <td class="space-x-1">
          <button class="btn-secondary approve-btn" data-id="${a.id}">Approve</button>
          <button class="btn-danger reject-btn" data-id="${a.id}">Reject</button>
        </td>
      </tr>`).join("")}</tbody></table>`;
    qsa(".approve-btn", el).forEach(b => b.addEventListener("click", () => updateAdmissionStatus(b.dataset.id, "approved")));
    qsa(".reject-btn", el).forEach(b => b.addEventListener("click", () => updateAdmissionStatus(b.dataset.id, "rejected")));
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load admissions.");
  }
}

async function updateAdmissionStatus(id, status) {
  try {
    const { error } = await sb.from("admissions").update({ status }).eq("id", id);
    if (error) throw error;
    showToast(`Admission ${status}.`, "success");
    loadAdminAdmissions();
    loadAdminOverview();
  } catch (err) {
    showToast(err.message || "Update failed.", "error");
  }
}

// --- Courses management ---
async function loadAdminCourses() {
  const el = $("coursesTableWrap");
  el.innerHTML = loadingHtml("Loading courses...");
  try {
    const { data, error } = await sb.from("courses").select("id, name, description, fee, active").order("name");
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No courses yet."); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Name</th><th>Fee</th><th>Active</th><th>Actions</th></tr></thead><tbody>
      ${data.map(c => `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td>₦${Number(c.fee).toLocaleString()}</td>
        <td>${c.active ? "Yes" : "No"}</td>
        <td class="space-x-1">
          <button class="btn-secondary edit-course-btn" data-id="${c.id}">Edit</button>
          <button class="btn-secondary toggle-course-btn" data-id="${c.id}" data-active="${c.active}">${c.active ? "Deactivate" : "Activate"}</button>
          <button class="btn-danger delete-course-btn" data-id="${c.id}">Delete</button>
        </td>
      </tr>`).join("")}</tbody></table>`;
    qsa(".edit-course-btn", el).forEach(b => b.addEventListener("click", () => openCourseModal(data.find(c => c.id === b.dataset.id))));
    qsa(".toggle-course-btn", el).forEach(b => b.addEventListener("click", () => toggleCourseActive(b.dataset.id, b.dataset.active === "true")));
    qsa(".delete-course-btn", el).forEach(b => b.addEventListener("click", () => deleteRow("courses", b.dataset.id, loadAdminCourses)));
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load courses.");
  }
}

function openCourseModal(course) {
  const isEdit = !!course;
  openModal(isEdit ? "Edit Course" : "Add Course", `
    <form id="courseForm" class="space-y-3">
      <div><label class="block text-sm font-medium mb-1">Course Name</label><input id="cName" class="form-input" required value="${escapeHtml(course ? course.name : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Short Description</label><input id="cDesc" class="form-input" value="${escapeHtml(course ? course.description : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Fee (₦)</label><input id="cFee" type="number" min="0" step="1" class="form-input" required value="${course ? course.fee : ""}"></div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="cActive" ${(!course || course.active) ? "checked" : ""}> Active (visible to public)</label>
      <button type="submit" class="btn-primary">${isEdit ? "Save Changes" : "Add Course"}</button>
    </form>`, () => {
    $("courseForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        name: $("cName").value.trim(),
        description: $("cDesc").value.trim(),
        fee: parseFloat($("cFee").value) || 0,
        active: $("cActive").checked
      };
      try {
        const { error } = isEdit
          ? await sb.from("courses").update(payload).eq("id", course.id)
          : await sb.from("courses").insert(payload);
        if (error) throw error;
        closeModal(); showToast("Course saved.", "success"); loadAdminCourses(); loadAdminOverview();
      } catch (err) { showToast(err.message || "Failed to save course.", "error"); }
    });
  });
}

async function toggleCourseActive(id, current) {
  try {
    const { error } = await sb.from("courses").update({ active: !current }).eq("id", id);
    if (error) throw error;
    loadAdminCourses(); loadAdminOverview();
  } catch (err) { showToast(err.message || "Failed to update.", "error"); }
}

async function deleteRow(table, id, cb) {
  if (!confirm("Are you sure you want to delete this item?")) return;
  try {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
    showToast("Deleted.", "success");
    if (cb) cb();
  } catch (err) { showToast(err.message || "Delete failed.", "error"); }
}

// --- Fees management ---
async function loadAdminFees() {
  const el = $("feesTableWrap");
  el.innerHTML = loadingHtml("Loading fees...");
  try {
    const { data, error } = await sb.from("fees").select("id, class, monthly_fee, active").order("class");
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No class fees set yet."); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Class</th><th>Monthly Fee</th><th>Active</th><th>Actions</th></tr></thead><tbody>
      ${data.map(f => `<tr>
        <td>${escapeHtml(f.class)}</td><td>₦${Number(f.monthly_fee).toLocaleString()}</td><td>${f.active ? "Yes" : "No"}</td>
        <td class="space-x-1">
          <button class="btn-secondary edit-fee-btn" data-id="${f.id}">Edit</button>
          <button class="btn-danger delete-fee-btn" data-id="${f.id}">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    qsa(".edit-fee-btn", el).forEach(b => b.addEventListener("click", () => openFeeModal(data.find(f => f.id === b.dataset.id))));
    qsa(".delete-fee-btn", el).forEach(b => b.addEventListener("click", () => deleteRow("fees", b.dataset.id, loadAdminFees)));
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load fees.");
  }
}

function openFeeModal(fee) {
  const isEdit = !!fee;
  openModal(isEdit ? "Edit Class Fee" : "Add Class Fee", `
    <form id="feeForm" class="space-y-3">
      <div><label class="block text-sm font-medium mb-1">Class</label><input id="fClass" class="form-input" required value="${escapeHtml(fee ? fee.class : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Monthly Fee (₦)</label><input id="fFee" type="number" min="0" step="1" class="form-input" required value="${fee ? fee.monthly_fee : ""}"></div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="fActive" ${(!fee || fee.active) ? "checked" : ""}> Active</label>
      <button type="submit" class="btn-primary">${isEdit ? "Save Changes" : "Add Fee"}</button>
    </form>`, () => {
    $("feeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = { class: $("fClass").value.trim(), monthly_fee: parseFloat($("fFee").value) || 0, active: $("fActive").checked };
      try {
        const { error } = isEdit
          ? await sb.from("fees").update(payload).eq("id", fee.id)
          : await sb.from("fees").insert(payload);
        if (error) throw error;
        closeModal(); showToast("Fee saved.", "success"); loadAdminFees();
      } catch (err) { showToast(err.message || "Failed to save fee.", "error"); }
    });
  });
}

// --- Notices management ---
async function loadAdminNotices() {
  const el = $("noticesTableWrap");
  el.innerHTML = loadingHtml("Loading notices...");
  try {
    const { data, error } = await sb.from("notices").select("id, title, created_at").order("created_at", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No notices yet."); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Title</th><th>Date</th><th>Actions</th></tr></thead><tbody>
      ${data.map(n => `<tr><td>${escapeHtml(n.title)}</td><td>${formatDate(n.created_at)}</td>
        <td class="space-x-1">
          <button class="btn-secondary edit-notice-btn" data-id="${n.id}">Edit</button>
          <button class="btn-danger delete-notice-btn" data-id="${n.id}">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    qsa(".edit-notice-btn", el).forEach(b => b.addEventListener("click", async () => {
      const { data: full } = await sb.from("notices").select("*").eq("id", b.dataset.id).single();
      openNoticeModal(full);
    }));
    qsa(".delete-notice-btn", el).forEach(b => b.addEventListener("click", () => deleteRow("notices", b.dataset.id, () => { loadAdminNotices(); loadAdminOverview(); })));
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load notices.");
  }
}

function openNoticeModal(notice) {
  const isEdit = !!notice;
  openModal(isEdit ? "Edit Notice" : "Add Notice", `
    <form id="noticeForm" class="space-y-3">
      <div><label class="block text-sm font-medium mb-1">Title</label><input id="nTitle" class="form-input" required value="${escapeHtml(notice ? notice.title : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Description</label><textarea id="nDesc" rows="3" class="form-input">${escapeHtml(notice ? notice.description : "")}</textarea></div>
      <div><label class="block text-sm font-medium mb-1">Image (optional)</label><input id="nImage" type="file" accept="image/*" class="form-input"></div>
      <p id="noticeFormMsg" class="text-sm hidden"></p>
      <button type="submit" class="btn-primary">${isEdit ? "Save Changes" : "Add Notice"}</button>
    </form>`, () => {
    $("noticeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("noticeFormMsg");
      try {
        let image_url = notice ? notice.image_url : null;
        const file = $("nImage").files[0];
        if (file) image_url = await uploadFile("notices", file, "notice");
        const payload = { title: $("nTitle").value.trim(), description: $("nDesc").value.trim(), image_url, updated_at: new Date().toISOString() };
        const { error } = isEdit
          ? await sb.from("notices").update(payload).eq("id", notice.id)
          : await sb.from("notices").insert(payload);
        if (error) throw error;
        closeModal(); showToast("Notice saved.", "success"); loadAdminNotices(); loadAdminOverview();
      } catch (err) {
        msg.textContent = err.message || "Failed to save notice."; msg.className = "text-sm text-red-600"; msg.classList.remove("hidden");
      }
    });
  });
}

// --- Leaderboard management ---
async function loadAdminLeaderboard() {
  const el = $("leaderTableWrap");
  el.innerHTML = loadingHtml("Loading leaderboard...");
  try {
    const { data, error } = await sb.from("leaderboard")
      .select("id, student_name, class, percentage, exam_date, week_identifier, photo_url")
      .order("percentage", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No leaderboard entries yet."); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Student</th><th>Class</th><th>%</th><th>Exam Date</th><th>Week</th><th>Actions</th></tr></thead><tbody>
      ${data.map(s => `<tr>
        <td>${escapeHtml(s.student_name)}</td><td>${escapeHtml(s.class || "")}</td><td>${s.percentage}%</td>
        <td>${formatDate(s.exam_date)}</td><td>${escapeHtml(s.week_identifier || "")}</td>
        <td class="space-x-1">
          <button class="btn-secondary edit-leader-btn" data-id="${s.id}">Edit</button>
          <button class="btn-danger delete-leader-btn" data-id="${s.id}">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    qsa(".edit-leader-btn", el).forEach(b => b.addEventListener("click", () => openLeaderModal(data.find(s => s.id === b.dataset.id))));
    qsa(".delete-leader-btn", el).forEach(b => b.addEventListener("click", () => deleteRow("leaderboard", b.dataset.id, loadAdminLeaderboard)));
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load leaderboard.");
  }
}

function openLeaderModal(entry) {
  const isEdit = !!entry;
  openModal(isEdit ? "Edit Student" : "Add Student", `
    <form id="leaderForm" class="space-y-3">
      <div><label class="block text-sm font-medium mb-1">Student Name</label><input id="lName" class="form-input" required value="${escapeHtml(entry ? entry.student_name : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Class</label><input id="lClass" class="form-input" value="${escapeHtml(entry ? entry.class : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Percentage</label><input id="lPct" type="number" min="0" max="100" step="0.1" class="form-input" required value="${entry ? entry.percentage : ""}"></div>
      <div><label class="block text-sm font-medium mb-1">Exam Date</label><input id="lDate" type="date" class="form-input" value="${entry && entry.exam_date ? entry.exam_date : ""}"></div>
      <div><label class="block text-sm font-medium mb-1">Week Identifier</label><input id="lWeek" class="form-input" placeholder="e.g. 2026-W05" value="${escapeHtml(entry ? entry.week_identifier : "")}"></div>
      <div><label class="block text-sm font-medium mb-1">Photo (optional)</label><input id="lPhoto" type="file" accept="image/*" class="form-input"></div>
      <p id="leaderFormMsg" class="text-sm hidden"></p>
      <button type="submit" class="btn-primary">${isEdit ? "Save Changes" : "Add Student"}</button>
    </form>`, () => {
    $("leaderForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("leaderFormMsg");
      try {
        let photo_url = entry ? entry.photo_url : null;
        const file = $("lPhoto").files[0];
        if (file) photo_url = await uploadFile("leaderboard-photos", file, "student");
        const payload = {
          student_name: $("lName").value.trim(),
          class: $("lClass").value.trim(),
          percentage: parseFloat($("lPct").value) || 0,
          exam_date: $("lDate").value || null,
          week_identifier: $("lWeek").value.trim(),
          photo_url,
          updated_at: new Date().toISOString()
        };
        const { error } = isEdit
          ? await sb.from("leaderboard").update(payload).eq("id", entry.id)
          : await sb.from("leaderboard").insert(payload);
        if (error) throw error;
        closeModal(); showToast("Leaderboard entry saved.", "success"); loadAdminLeaderboard();
      } catch (err) {
        msg.textContent = err.message || "Failed to save entry."; msg.className = "text-sm text-red-600"; msg.classList.remove("hidden");
      }
    });
  });
}

// --- Users management ---
async function loadAdminUsers() {
  const el = $("usersTableWrap");
  el.innerHTML = loadingHtml("Loading users...");
  try {
    const { data, error } = await sb.from("profiles").select("id, full_name, profession, role").order("full_name");
    if (error) throw error;
    if (!data || data.length === 0) { el.innerHTML = emptyHtml("No users found."); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Name</th><th>Profession</th><th>Role</th><th>Actions</th></tr></thead><tbody>
      ${data.map(u => `<tr>
        <td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.profession || "")}</td>
        <td><select class="form-input !py-1 !w-28 role-select" data-id="${u.id}">
          ${["student", "teacher", "parent", "admin"].map(r => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
        </select></td>
        <td><button class="btn-secondary save-role-btn" data-id="${u.id}">Save</button></td>
      </tr>`).join("")}</tbody></table>`;
    qsa(".save-role-btn", el).forEach(b => b.addEventListener("click", async () => {
      const sel = qs(`.role-select[data-id="${b.dataset.id}"]`, el);
      try {
        const { error } = await sb.from("profiles").update({ role: sel.value }).eq("id", b.dataset.id);
        if (error) throw error;
        showToast("Role updated.", "success");
      } catch (err) { showToast(err.message || "Failed to update role.", "error"); }
    }));
  } catch (err) {
    el.innerHTML = errorHtml("Failed to load users.");
  }
}

// ===============================
// INIT
// ===============================
function initHomePreviews() {
  loadNotices("homeNoticePreview", 3);
  loadLeaderboard("homeLeaderboardPreview", false);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("footerYear").textContent = new Date().getFullYear();

  if (!CONFIG_OK) {
    $("configBanner").classList.remove("hidden");
  }

  initNavigation();
  initAuth();
  loadSiteSettings();
  initHomePreviews();

  if (sb) {
    await loadSessionProfile();
  }
});

/* ============================================================
   SUGGESTED SUPABASE SETUP (run once in Supabase SQL editor)
   This is reference only — it is NOT executed by the frontend.
   ============================================================

create extension if not exists pgcrypto;

-- PROFILES -----------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  profession text,
  role text not null default 'student' check (role in ('student','teacher','parent','admin')),
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "read own profile" on profiles for select using (auth.uid() = id);
create policy "admin read all profiles" on profiles for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "insert own profile" on profiles for insert with check (auth.uid() = id and role <> 'admin');
create policy "admin update profiles" on profiles for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- COURSES --------------------------------------------------------
create table courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  fee numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table courses enable row level security;
create policy "public read active courses" on courses for select using (active = true);
create policy "admin manage courses" on courses for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- FEES -------------------------------------------------------------
create table fees (
  id uuid primary key default gen_random_uuid(),
  class text unique not null,
  monthly_fee numeric not null default 0,
  active boolean not null default true
);
alter table fees enable row level security;
create policy "public read active fees" on fees for select using (active = true);
create policy "admin manage fees" on fees for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ADMISSIONS -------------------------------------------------------
create table admissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  student_name text not null,
  student_address text not null,
  student_class text not null,
  student_phone text not null,
  study_type text not null check (study_type in ('monthly','course')),
  course_id uuid references courses(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);
alter table admissions enable row level security;
create policy "users create own admission" on admissions for insert with check (
  user_id is null or user_id = auth.uid());
create policy "users read own admission" on admissions for select using (
  user_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "admin manage admissions" on admissions for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "admin delete admissions" on admissions for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- GUARDIANS ----------------------------------------------------------
create table guardians (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid references admissions(id) on delete cascade,
  guardian_name text not null,
  guardian_phone text not null
);
alter table guardians enable row level security;
create policy "insert guardians with own admission" on guardians for insert with check (
  exists (select 1 from admissions a where a.id = admission_id and (a.user_id = auth.uid() or a.user_id is null)));
create policy "read guardians of own admission or admin" on guardians for select using (
  exists (select 1 from admissions a where a.id = admission_id and a.user_id = auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- NOTICES --------------------------------------------------------------
create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table notices enable row level security;
create policy "public read notices" on notices for select using (true);
create policy "admin manage notices" on notices for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- LEADERBOARD ------------------------------------------------------------
create table leaderboard (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  photo_url text,
  class text,
  percentage numeric not null,
  exam_date date,
  week_identifier text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table leaderboard enable row level security;
create policy "public read leaderboard" on leaderboard for select using (true);
create policy "admin manage leaderboard" on leaderboard for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- SITE SETTINGS -------------------------------------------------------------
create table site_settings (
  id int primary key default 1,
  site_name text default 'EDUBEMI',
  slogan text,
  phone text,
  email text,
  address text,
  maps_url text,
  updated_at timestamptz default now()
);
alter table site_settings enable row level security;
create policy "public read settings" on site_settings for select using (true);
create policy "admin manage settings" on site_settings for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
insert into site_settings (id) values (1) on conflict do nothing;

-- STORAGE BUCKETS ---------------------------------------------------------
-- Create buckets "notices" and "leaderboard-photos" as PUBLIC buckets
-- via Supabase Dashboard > Storage. Add policies allowing:
--   - public SELECT (read) on both buckets
--   - INSERT/UPDATE/DELETE only for authenticated users with role = 'admin'
--     (check against profiles table similarly to the policies above)

-- To create your first admin: sign up normally through the app, then run:
--   update profiles set role = 'admin' where id = '<the user''s auth id>';
   ============================================================ */
