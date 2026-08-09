/* =========================================================
   MPK District Account Register — app.js
   Firestore (cloud + offline persistence) backed data layer
   ========================================================= */

const DEFAULT_DROPDOWNS = {
  accountType: ["Cash", "Cheque", "Bank Transfer", "Easypaisa / JazzCash", "Card"],
  department: ["General Donation", "Zakat", "Sadqa", "Fitrana", "Qurbani", "Membership", "Other"],
  subhead: ["General", "Emergency Relief", "Education", "Health", "Food", "Other"],
  city: ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Gujranwala", "Sialkot", "Other"]
};

let db, auth;
let workspaceCode = localStorage.getItem("mpk_workspace") || (window.WORKSPACE_CODE || "MPK-DISTRICT-2026");
let entries = [];
let dropdowns = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
let editingId = null;
let unsubEntries = null, unsubDropdowns = null;
let currentUser = null;

/* ---------- Init ---------- */
function init() {
  document.getElementById("workspaceCodeInput").value = workspaceCode;
  setDefaultDate();
  bindNav();
  bindForm();
  bindRecords();
  bindSettings();
  bindAuth();
  initFirebase();
}

function setDefaultDate() {
  const d = new Date();
  document.getElementById("f_date").value = d.toISOString().slice(0, 10);
}

/* ---------- Firebase ---------- */
function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === "PASTE_YOUR_API_KEY") {
    setStatus("offline", "Firebase config missing — sirf local demo mode");
    document.getElementById("authOverlay").classList.add("hidden");
    renderDropdownEditor();
    renderAll();
    return;
  }
  try {
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    auth = firebase.auth();
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      console.warn("Persistence not enabled:", err.code);
    });

    auth.onAuthStateChanged((user) => {
      if (user) {
        currentUser = user;
        document.getElementById("authOverlay").classList.add("hidden");
        document.getElementById("userLine").classList.remove("hidden");
        document.getElementById("userLine").textContent = "👤 " + (user.displayName || user.email);
        document.getElementById("accountInfo").textContent =
          (user.displayName || "") + (user.email ? " · " + user.email : "");
        ensureUserDoc(user);
        document.getElementById("adminCard").classList.toggle("hidden", !isAdmin(user));
        if (isAdmin(user)) renderVolunteerList();
        attachListeners();
      } else {
        currentUser = null;
        document.getElementById("authOverlay").classList.remove("hidden");
      }
    });

    window.addEventListener("online", () => setStatus("online", "Sync ho gaya"));
    window.addEventListener("offline", () => setStatus("offline", "Offline — data local save ho raha hai"));
  } catch (e) {
    setStatus("offline", "Firebase init failed — local demo mode");
    console.error(e);
    renderDropdownEditor();
    renderAll();
  }
}

function wsRef() {
  return db.collection("workspaces").doc(workspaceCode);
}

function attachListeners() {
  if (unsubEntries) unsubEntries();
  if (unsubDropdowns) unsubDropdowns();

  unsubEntries = wsRef().collection("entries").orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
      setStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "Sync ho gaya" : "Offline — data local save ho raha hai");
    }, (err) => {
      console.error(err);
      setStatus("offline", "Sync error");
    });

  unsubDropdowns = wsRef().collection("config").doc("dropdowns")
    .onSnapshot((doc) => {
      if (doc.exists) {
        dropdowns = doc.data();
      } else {
        wsRef().collection("config").doc("dropdowns").set(DEFAULT_DROPDOWNS);
        dropdowns = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
      }
      renderDropdownSelects();
      renderDropdownEditor();
    });
}

function switchWorkspace(newCode) {
  workspaceCode = newCode.trim() || "MPK-DISTRICT-2026";
  localStorage.setItem("mpk_workspace", workspaceCode);
  if (db) attachListeners();
  showToast("Workspace set: " + workspaceCode);
}

function setStatus(state, text) {
  document.getElementById("statusDot").className = "status-dot " + state;
  document.getElementById("statusText").textContent = text;
}

/* ---------- Auth ---------- */
function bindAuth() {
  document.getElementById("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const pass = document.getElementById("loginPassword").value;
    const errEl = document.getElementById("authError");
    errEl.classList.add("hidden");
    auth.signInWithEmailAndPassword(email, pass).catch((err) => {
      errEl.textContent = friendlyAuthError(err);
      errEl.classList.remove("hidden");
    });
  });

  document.getElementById("logoutBtn").addEventListener("click", () => auth.signOut());
  document.getElementById("logoutBtn2").addEventListener("click", () => auth.signOut());

  document.getElementById("createVolunteerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    createVolunteer();
  });
}

function isAdmin(user) {
  const admins = window.ADMIN_EMAILS || [];
  return !!user && admins.includes(user.email);
}

function ensureUserDoc(user) {
  if (!db) return;
  wsRef().collection("users").doc(user.uid).set({
    name: user.displayName || "",
    email: user.email || "",
    role: isAdmin(user) ? "admin" : "volunteer"
  }, { merge: true });
}

function renderVolunteerList() {
  if (!db) return;
  wsRef().collection("users").orderBy("name").get().then((snap) => {
    const list = document.getElementById("volunteerList");
    if (snap.empty) { list.innerHTML = `<p class="hint">Abhi koi volunteer nahi hai.</p>`; return; }
    list.innerHTML = snap.docs.map((d) => {
      const u = d.data();
      return `<div class="receipt-card vol-card">
        <div class="rc-top">
          <span class="rc-donor">${escapeHtml(u.name || "—")}</span>
          ${u.role === "admin" ? '<span class="rc-tag">Admin</span>' : ""}
        </div>
        <div class="rc-meta"><span class="rc-tag">${escapeHtml(u.email || "")}</span></div>
      </div>`;
    }).join("");
  });
}

function createVolunteer() {
  const name = document.getElementById("newVolName").value.trim();
  const email = document.getElementById("newVolEmail").value.trim();
  const pass = document.getElementById("newVolPassword").value;
  const errEl = document.getElementById("createVolError");
  errEl.classList.add("hidden");

  // Create the account on a SECONDARY firebase app instance so the admin's
  // own login session (on the primary app/auth) is not disturbed.
  const secondaryName = "Secondary-" + Date.now();
  const secondary = firebase.initializeApp(window.FIREBASE_CONFIG, secondaryName);
  secondary.auth().createUserWithEmailAndPassword(email, pass)
    .then((cred) => cred.user.updateProfile({ displayName: name }).then(() => cred.user))
    .then((user) => {
      return wsRef().collection("users").doc(user.uid).set({ name, email, role: "volunteer" });
    })
    .then(() => {
      showToast("Volunteer account ban gaya: " + name);
      document.getElementById("createVolunteerForm").reset();
      renderVolunteerList();
    })
    .catch((err) => {
      errEl.textContent = friendlyAuthError(err);
      errEl.classList.remove("hidden");
    })
    .finally(() => {
      secondary.auth().signOut().finally(() => secondary.delete());
    });
}

function friendlyAuthError(err) {
  const map = {
    "auth/invalid-email": "Email sahi format mein nahi hai",
    "auth/user-not-found": "Ye email registered nahi hai",
    "auth/wrong-password": "Password ghalat hai",
    "auth/email-already-in-use": "Ye email pehle se registered hai",
    "auth/weak-password": "Password kam se kam 6 characters ka hona chahiye",
  };
  return map[err.code] || err.message;
}

/* ---------- Navigation ---------- */
function bindNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "summary") renderSummary();
    });
  });
}

/* ---------- Dropdown selects (form) ---------- */
function renderDropdownSelects() {
  fillSelect("f_accountType", dropdowns.accountType);
  fillSelect("f_department", dropdowns.department);
  fillSelect("f_subhead", dropdowns.subhead);
  fillSelect("f_city", dropdowns.city);
}
function fillSelect(id, options) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = '<option value="" disabled selected>Select…</option>' +
    options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  if (options.includes(current)) sel.value = current;
}

/* ---------- Form ---------- */
function bindForm() {
  const form = document.getElementById("entryForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveEntry();
  });
  document.getElementById("f_book").addEventListener("input", checkDuplicate);
  document.getElementById("f_receipt").addEventListener("input", checkDuplicate);
  document.getElementById("cancelEditBtn").addEventListener("click", resetForm);
}

function checkDuplicate() {
  const book = document.getElementById("f_book").value.trim();
  const receipt = document.getElementById("f_receipt").value.trim();
  if (!book || !receipt) return hideDup();
  const dup = entries.find((e) => e.book === book && e.receipt === receipt && e.id !== editingId);
  document.getElementById("dupWarning").classList.toggle("hidden", !dup);
}
function hideDup() {
  document.getElementById("dupWarning").classList.add("hidden");
}

function saveEntry() {
  const data = {
    date: document.getElementById("f_date").value,
    book: document.getElementById("f_book").value.trim(),
    receipt: document.getElementById("f_receipt").value.trim(),
    accountType: document.getElementById("f_accountType").value,
    department: document.getElementById("f_department").value,
    subhead: document.getElementById("f_subhead").value,
    city: document.getElementById("f_city").value,
    donor: document.getElementById("f_donor").value.trim(),
    amount: parseFloat(document.getElementById("f_amount").value) || 0,
    mobile: document.getElementById("f_mobile").value.trim(),
    email: document.getElementById("f_email").value.trim(),
    refName: document.getElementById("f_refname").value.trim(),
    refMobile: document.getElementById("f_refmobile").value.trim(),
  };

  if (!db) {
    showToast("Firebase configured nahi — README dekhein");
    return;
  }

  if (editingId) {
    wsRef().collection("entries").doc(editingId).update(data)
      .then(() => { showToast("Entry update ho gayi"); resetForm(); })
      .catch((e) => showToast("Error: " + e.message));
  } else {
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    data.enteredBy = currentUser ? (currentUser.displayName || currentUser.email) : "";
    data.enteredByUid = currentUser ? currentUser.uid : "";
    wsRef().collection("entries").add(data)
      .then(() => { showToast("Receipt save ho gayi"); resetForm(); })
      .catch((e) => showToast("Error: " + e.message));
  }
}

function resetForm() {
  document.getElementById("entryForm").reset();
  setDefaultDate();
  editingId = null;
  document.getElementById("entryId").value = "";
  document.getElementById("saveBtn").textContent = "Receipt Save Karein";
  document.getElementById("cancelEditBtn").classList.add("hidden");
  hideDup();
  renderDropdownSelects();
}

function editEntry(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  document.getElementById("f_date").value = e.date || "";
  document.getElementById("f_book").value = e.book || "";
  document.getElementById("f_receipt").value = e.receipt || "";
  document.getElementById("f_accountType").value = e.accountType || "";
  document.getElementById("f_department").value = e.department || "";
  document.getElementById("f_subhead").value = e.subhead || "";
  document.getElementById("f_city").value = e.city || "";
  document.getElementById("f_donor").value = e.donor || "";
  document.getElementById("f_amount").value = e.amount || "";
  document.getElementById("f_mobile").value = e.mobile || "";
  document.getElementById("f_email").value = e.email || "";
  document.getElementById("f_refname").value = e.refName || "";
  document.getElementById("f_refmobile").value = e.refMobile || "";
  document.getElementById("saveBtn").textContent = "Update Karein";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  document.querySelector('.nav-btn[data-tab="entry"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteEntry(id) {
  if (!confirm("Ye receipt delete karni hai?")) return;
  wsRef().collection("entries").doc(id).delete()
    .then(() => showToast("Delete ho gayi"))
    .catch((e) => showToast("Error: " + e.message));
}

/* ---------- Records list ---------- */
function bindRecords() {
  document.getElementById("searchInput").addEventListener("input", renderRecords);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("exportXlsxBtn").addEventListener("click", exportXlsx);
  document.getElementById("backupBtn").addEventListener("click", backupJson);
  document.getElementById("restoreBtn").addEventListener("click", () => document.getElementById("restoreFileInput").click());
  document.getElementById("restoreFileInput").addEventListener("change", restoreJson);
  document.getElementById("downloadTemplateBtn").addEventListener("click", downloadTemplate);
  document.getElementById("importDataBtn").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", importFile);
}

function renderRecords() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const list = document.getElementById("recordsList");
  const filtered = !q ? entries : entries.filter((e) =>
    [e.donor, e.book, e.receipt, e.city, e.department, e.accountType, e.mobile, e.refName]
      .some((v) => (v || "").toString().toLowerCase().includes(q))
  );
  document.getElementById("recordsEmpty").classList.toggle("hidden", filtered.length > 0);
  list.innerHTML = filtered.map((e) => `
    <div class="receipt-card">
      <div class="rc-top">
        <span class="rc-donor">${escapeHtml(e.donor || "—")}</span>
        <span class="rc-amount">Rs ${Number(e.amount || 0).toLocaleString()}</span>
      </div>
      <div class="rc-meta">
        <span class="rc-tag">${escapeHtml(e.date || "")}</span>
        <span class="rc-tag">Book ${escapeHtml(e.book || "")}</span>
        <span class="rc-tag">Receipt ${escapeHtml(e.receipt || "")}</span>
        <span class="rc-tag">${escapeHtml(e.city || "")}</span>
        <span class="rc-tag">${escapeHtml(e.accountType || "")}</span>
        <span class="rc-tag">${escapeHtml(e.department || "")}</span>
        ${e.enteredBy ? `<span class="rc-tag">👤 ${escapeHtml(e.enteredBy)}</span>` : ""}
      </div>
      <div class="rc-actions">
        <button onclick="editEntry('${e.id}')">Edit</button>
        <button class="delete-btn" onclick="deleteEntry('${e.id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

/* ---------- Summary ---------- */
function renderSummary() {
  const total = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayTotal = entries.filter((e) => e.date === today).reduce((s, e) => s + Number(e.amount || 0), 0);

  document.getElementById("summaryTotals").innerHTML = `
    <div class="summary-card">
      <div class="val">Rs ${total.toLocaleString()}</div>
      <div class="lbl">Total (${entries.length} receipts)</div>
    </div>
    <div class="summary-card">
      <div class="val">Rs ${todayTotal.toLocaleString()}</div>
      <div class="lbl">Aaj ka total</div>
    </div>
  `;

  renderGroupTotals("summaryByBook", groupSum(entries, (e) => "Book " + (e.book || "—")));
  renderGroupTotals("summaryByCity", groupSum(entries, (e) => e.city || "—"));
}

function groupSum(list, keyFn) {
  const map = {};
  list.forEach((e) => {
    const k = keyFn(e);
    map[k] = (map[k] || 0) + Number(e.amount || 0);
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function renderGroupTotals(elId, rows) {
  const el = document.getElementById(elId);
  if (!rows.length) { el.innerHTML = `<div class="summary-row">Koi data nahi</div>`; return; }
  el.innerHTML = rows.map(([k, v]) => `
    <div class="summary-row"><span>${escapeHtml(k)}</span><span class="amt">Rs ${v.toLocaleString()}</span></div>
  `).join("");
}

/* ---------- Autocomplete lists ---------- */
function renderAutocompleteLists() {
  const donors = [...new Set(entries.map((e) => e.donor).filter(Boolean))];
  const refs = [...new Set(entries.map((e) => e.refName).filter(Boolean))];
  document.getElementById("donorList").innerHTML = donors.map((d) => `<option value="${escapeHtml(d)}">`).join("");
  document.getElementById("refList").innerHTML = refs.map((d) => `<option value="${escapeHtml(d)}">`).join("");
}

function renderAll() {
  renderRecords();
  renderSummary();
  renderAutocompleteLists();
}

/* ---------- Export ---------- */
function toRows() {
  return entries.map((e) => ({
    Date: e.date, "Book No": e.book, "Receipt No": e.receipt, "Account Type": e.accountType,
    Department: e.department, "Sub Head": e.subhead, City: e.city, "Donor/Name/Account": e.donor,
    Amount: e.amount, "Mobile Number": e.mobile, Email: e.email,
    "Reference Name": e.refName, "Reference Mobile No": e.refMobile
  }));
}

function exportCsv() {
  const rows = toRows();
  if (!rows.length) return showToast("Koi data nahi");
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(",")]
    .concat(rows.map((r) => headers.map((h) => `"${(r[h] ?? "").toString().replace(/"/g, '""')}"`).join(",")))
    .join("\n");
  downloadBlob(csv, "mpk-district-account.csv", "text/csv");
}

function exportXlsx() {
  const rows = toRows();
  if (!rows.length) return showToast("Koi data nahi");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Entries");
  XLSX.writeFile(wb, "mpk-district-account.xlsx");
}

function backupJson() {
  downloadBlob(JSON.stringify({ dropdowns, entries }, null, 2), "mpk-backup.json", "application/json");
}

function restoreJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm(`${data.entries.length} entries restore karni hain? Ye existing data mein add ho jayengi.`)) return;
      const batch = db.batch();
      data.entries.forEach((entry) => {
        const { id, ...rest } = entry;
        rest.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const ref = wsRef().collection("entries").doc();
        batch.set(ref, rest);
      });
      batch.commit().then(() => showToast("Restore complete"));
    } catch (err) {
      showToast("Invalid backup file");
    }
  };
  reader.readAsText(file);
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Template + bulk import (purana data) ---------- */
const TEMPLATE_HEADERS = ["Date","Book No","Receipt No","Account Type","Department","Sub Head","City","Donor/Name/Account","Amount","Mobile Number","Email","Reference Name","Reference Mobile No"];

function downloadTemplate() {
  const example = {
    "Date": "2026-01-15", "Book No": "12", "Receipt No": "045", "Account Type": "Cash",
    "Department": "General Donation", "Sub Head": "General", "City": "Lahore",
    "Donor/Name/Account": "Ahmed Khan", "Amount": 5000, "Mobile Number": "03001234567",
    "Email": "", "Reference Name": "", "Reference Mobile No": ""
  };
  const note = { "Date": "⬇ Is row ko delete kar dein, phir apna purana data neeche likhna shuru karein. Date format: YYYY-MM-DD (e.g. 2026-01-15)" };
  const ws = XLSX.utils.json_to_sheet([example], { header: TEMPLATE_HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Old Data Template");
  XLSX.writeFile(wb, "mpk-import-template.xlsx");
  showToast("Template download ho gaya");
}

function normalizeImportRow(r) {
  const get = (k) => (r[k] ?? "").toString().trim();
  let dateStr = "";
  const dateVal = r["Date"];
  if (dateVal instanceof Date) {
    dateStr = dateVal.toISOString().slice(0, 10);
  } else {
    dateStr = get("Date");
  }
  return {
    date: dateStr,
    book: get("Book No"),
    receipt: get("Receipt No"),
    accountType: get("Account Type"),
    department: get("Department"),
    subhead: get("Sub Head"),
    city: get("City"),
    donor: get("Donor/Name/Account"),
    amount: parseFloat(get("Amount")) || 0,
    mobile: get("Mobile Number"),
    email: get("Email"),
    refName: get("Reference Name"),
    refMobile: get("Reference Mobile No"),
  };
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("importStatus");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Padh raha hoon…";

  if (!db) {
    statusEl.textContent = "Firebase configured nahi — README dekhein";
    e.target.value = "";
    return;
  }

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const mapped = rows.map(normalizeImportRow).filter((r) => r.donor || r.amount);
    if (!mapped.length) {
      statusEl.textContent = "Koi valid row nahi mili — template ka format check karein";
      return;
    }

    const existingKeys = new Set(entries.filter((e) => e.book && e.receipt).map((e) => e.book + "|" + e.receipt));
    const seen = new Set();
    const toInsert = [];
    const newDropdownVals = { accountType: new Set(), department: new Set(), subhead: new Set(), city: new Set() };

    mapped.forEach((r) => {
      const key = r.book + "|" + r.receipt;
      if (r.book && r.receipt && (existingKeys.has(key) || seen.has(key))) return;
      seen.add(key);
      toInsert.push(r);
      ["accountType", "department", "subhead", "city"].forEach((k) => {
        if (r[k] && dropdowns[k] && !dropdowns[k].includes(r[k])) newDropdownVals[k].add(r[k]);
      });
    });

    const skipped = mapped.length - toInsert.length;
    if (!toInsert.length) {
      statusEl.textContent = `Koi nayi entry nahi mili (${skipped} pehle se maujood, duplicate Book+Receipt No ki wajah se skip hui)`;
      return;
    }

    // Firestore batches max 500 writes — chunk at 400 to be safe
    const chunkSize = 400;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const batch = db.batch();
      chunk.forEach((r) => {
        const ref = wsRef().collection("entries").doc();
        batch.set(ref, {
          ...r,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          enteredBy: currentUser ? (currentUser.displayName || currentUser.email) : "",
          enteredByUid: currentUser ? currentUser.uid : "",
          importedFromTemplate: true
        });
      });
      await batch.commit();
      statusEl.textContent = `Import ho raha hai… ${Math.min(i + chunkSize, toInsert.length)}/${toInsert.length}`;
    }

    let ddChanged = false;
    Object.keys(newDropdownVals).forEach((k) => {
      newDropdownVals[k].forEach((v) => { dropdowns[k].push(v); ddChanged = true; });
    });
    if (ddChanged) saveDropdowns();

    statusEl.textContent = `✔ ${toInsert.length} entries import ho gayin` + (skipped ? ` · ${skipped} duplicate skip hui` : "");
    showToast(`${toInsert.length} entries import ho gayin`);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Import fail ho gaya: " + err.message;
  } finally {
    e.target.value = "";
  }
}

/* ---------- Settings: workspace + dropdown editor ---------- */
function bindSettings() {
  document.getElementById("saveWorkspaceBtn").addEventListener("click", () => {
    switchWorkspace(document.getElementById("workspaceCodeInput").value);
  });
}

const DD_LABELS = { accountType: "Account Type", department: "Department", subhead: "Sub Head", city: "City" };

function renderDropdownEditor() {
  const el = document.getElementById("dropdownEditor");
  el.innerHTML = Object.keys(DD_LABELS).map((key) => `
    <div class="dd-group" data-key="${key}">
      <h4>${DD_LABELS[key]}</h4>
      <div class="dd-chips">
        ${(dropdowns[key] || []).map((val, i) => `
          <span class="dd-chip">${escapeHtml(val)}<button data-key="${key}" data-idx="${i}" class="dd-remove">×</button></span>
        `).join("")}
      </div>
      <div class="dd-add">
        <input type="text" placeholder="Naya option add karein…" data-key="${key}" class="dd-input" />
        <button class="btn btn-outline btn-sm dd-add-btn" data-key="${key}">Add</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".dd-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key, idx = Number(btn.dataset.idx);
      dropdowns[key].splice(idx, 1);
      saveDropdowns();
    });
  });
  el.querySelectorAll(".dd-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const input = el.querySelector(`.dd-input[data-key="${key}"]`);
      const val = input.value.trim();
      if (!val) return;
      dropdowns[key] = dropdowns[key] || [];
      if (!dropdowns[key].includes(val)) dropdowns[key].push(val);
      input.value = "";
      saveDropdowns();
    });
  });
}

function saveDropdowns() {
  if (db) {
    wsRef().collection("config").doc("dropdowns").set(dropdowns);
  } else {
    renderDropdownSelects();
    renderDropdownEditor();
  }
}

/* ---------- Utils ---------- */
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}
function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Register service worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  });
}

init();
