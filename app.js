/* Private offline-first expense notes. Records remain in this browser's local IndexedDB. */
(() => {
  "use strict";
  const DB_NAME = "notes-style-expenses";
  const DB_VERSION = 1;
  const STORE = "expenses";
  const SETTINGS_KEY = "settings";
  const $ = (id) => document.getElementById(id);
  const list = $("notesList");
  const summaryMonth = $("summaryMonth");
  const summaryTotal = $("summaryTotal");
  const status = $("status");
  const settingsDialog = $("settingsDialog");
  const editDialog = $("editDialog");
  let db;
  let expenses = [];
  let settings = { autopay: 430, months: [] };
  let activeMonth = "";
  let observer;
  let statusTimer;

  const money = (value) => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthLabel = (key) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("date", "date", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function getAll() {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
  function putExpense(item) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  function deleteExpense(idValue) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(idValue);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { console.error(error); }
  }
  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      settings = { ...settings, ...stored, months: Array.isArray(stored.months) ? stored.months : [] };
    } catch (_) {}
    // Migrate months configured in the earlier version.
    if (settings.startMonth) {
      settings.months.push(settings.startMonth);
      delete settings.startMonth;
      saveSettings();
    }
  }
  function flash(message, isError = false) {
    status.textContent = message;
    status.style.color = isError ? "#ff8d94" : "#70d7a1";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ""; }, 2400);
  }
 function parseEntry(raw) {
  let text = raw.trim();
  if (!text) return null;

  let paymentType = "bank";

  if (/\s*\(cash\)\s*$/i.test(text)) {
    paymentType = "cash";
    text = text.replace(/\s*\(cash\)\s*$/i, "").trim();
  }

  const match = text.match(
    /^(.*?)(?:\s*[.·]\s*|\s+)(?:₹\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)\s*$/
  );

  if (!match) return { title: text, amount: null, paymentType };

  const title = match[1].trim().replace(/[.·]\s*$/, "").trim();
  const amount = Number(match[2].replace(/,/g, ""));

  if (!title || !Number.isFinite(amount) || amount < 0) return null;

  return { title, amount, paymentType };
}
  function parseMonthCommand(raw, fromMonth) {
    const text = raw.trim().replace(/[.!]+$/, "").trim();
    const match = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?$/i);
    if (!match) return null;
    const names = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const month = names.indexOf(match[1].toLowerCase()) + 1;
    let year;
    if (match[2]) year = Number(match[2]);
    else {
      const [baseYear, baseMonth] = (fromMonth || monthKey(new Date())).split("-").map(Number);
      year = baseYear;
      // A month without a year means the next occurrence of that month after the current section.
      if (month < baseMonth) year++;
    }
    if (year < 1900 || year > 2200) return null;
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  function allMonths() {
    const set = new Set(expenses.map(e => e.date.slice(0, 7)));
    set.add(monthKey(new Date()));
    settings.months.forEach(m => { if (/^\d{4}-\d{2}$/.test(m)) set.add(m); });
    return [...set].sort();
  }
  function sumForMonth(key) {
  const monthExpenses = expenses.filter(e => e.date.slice(0, 7) === key);

  const bank = monthExpenses
    .filter(e => e.paymentType !== "cash")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0)
    + Number(settings.autopay || 0);

  const cash = monthExpenses
    .filter(e => e.paymentType === "cash")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  return { bank, cash, total: bank + cash };
}
  function updateSummary(key) {
    if (!key) return;
    activeMonth = key;
    summaryMonth.textContent = monthLabel(key);
    const totals = sumForMonth(key);
summaryTotal.textContent =
  `Bank ${money(totals.bank)} · Cash ${money(totals.cash)} · Total ${money(totals.total)}`;
    document.title = `${monthLabel(key)} · Expenses`;
  }
  function addMonth(key) {
    if (!settings.months.includes(key)) settings.months.push(key);
    settings.months.sort();
    saveSettings();
  }
  function dateForMonth(key) {
    const [year, month] = key.split("-").map(Number);
    const today = new Date();
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(today.getDate(), lastDay);
    return `${key}-${String(day).padStart(2, "0")}`;
  }
  function focusMonthInput(key) {
    requestAnimationFrame(() => {
      const section = list.querySelector(`[data-month="${key}"]`);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      section?.querySelector(".month-input")?.focus({ preventScroll: true });
    });
  }
  function render() {
    const months = allMonths();
    if (observer) observer.disconnect();
    list.replaceChildren();
    months.forEach(key => {
      const section = document.createElement("section");
      section.className = "month-section";
      section.dataset.month = key;
      const heading = document.createElement("h2");
      heading.className = "month-heading";
      heading.textContent = monthLabel(key);
      heading.addEventListener("click", () => updateSummary(key));
      section.appendChild(heading);

      const form = document.createElement("form");
      form.className = "month-form";
      form.autocomplete = "off";
      const input = document.createElement("input");
      input.className = "month-input";
      input.type = "text";
      input.placeholder = "Add expense…";
      input.enterKeyHint = "done";
      input.autocapitalize = "sentences";
      input.spellcheck = false;
      input.setAttribute("aria-label", `Add expense to ${monthLabel(key)}`);
      const add = document.createElement("button");
      add.type = "submit";
      add.className = "add-button";
      add.textContent = "+";
      add.setAttribute("aria-label", `Add to ${monthLabel(key)}`);
      form.append(input, add);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const raw = input.value.trim();
        if (!raw) return;
        const requestedMonth = parseMonthCommand(raw, key);
        if (requestedMonth) {
          addMonth(requestedMonth);
          updateSummary(requestedMonth);
          render();
          focusMonthInput(requestedMonth);
          return;
        }
        const parsed = parseEntry(raw);
        if (!parsed || parsed.amount === null) { flash("Enter description and amount", true); return; }
        const item = {
  id: id(),
  title: parsed.title,
  amount: parsed.amount,
  paymentType: parsed.paymentType,
  date: dateForMonth(key),
  createdAt: Date.now()
};
        try {
          await putExpense(item);
          input.value = "";
          await refresh();
          updateSummary(key);
          focusMonthInput(key);
        } catch (_) { flash("Could not save this entry", true); }
      });
      section.appendChild(form);

      const monthExpenses = expenses.filter(e => e.date.slice(0, 7) === key)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      monthExpenses.forEach(item => {
        const row = document.createElement("div");
        row.className = "expense-row";
        const title = document.createElement("div");
        title.className = "expense-title";
        title.textContent = item.title;
        const amount = document.createElement("div");
        amount.className = "expense-amount";
        amount.textContent = money(item.amount);
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.setAttribute("aria-label", `Edit ${item.title}`);
        edit.addEventListener("click", () => openEdit(item));
        row.append(title, amount, edit);
        section.appendChild(row);
      });
      const totals = sumForMonth(key);

const total = document.createElement("div");
total.className = "month-total-line";
total.innerHTML = `
  <div>Bank Expenses: ${money(totals.bank)}</div>
  <div>Cash Expenses: ${money(totals.cash)}</div>
  <div>Total: ${money(totals.total)}</div>
`;
section.appendChild(total);
    
      list.appendChild(section);
    });
    if (months.length) {
      const current = monthKey(new Date());
      updateSummary(months.includes(activeMonth) ? activeMonth : (months.includes(current) ? current : months[months.length - 1]));
      observer = new IntersectionObserver((entries) => {
        const candidates = entries.filter(entry => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top - 65) - Math.abs(b.boundingClientRect.top - 65));
        if (candidates[0]) updateSummary(candidates[0].target.dataset.month);
      }, { root: null, rootMargin: "-60px 0px -65% 0px", threshold: [0, 0.01, 0.2] });
      list.querySelectorAll(".month-section").forEach(section => observer.observe(section));
    }
  }
  async function refresh() {
    expenses = await getAll();
    render();
  }
  function openEdit(item) {
    $("editId").value = item.id;
    $("editTitle").value = item.title;
    $("editAmount").value = item.amount;
    $("editDate").value = item.date;
    editDialog.showModal();
  }
  $("saveEdit").addEventListener("click", async () => {
    const item = expenses.find(e => e.id === $("editId").value);
    const title = $("editTitle").value.trim();
    const amount = Number($("editAmount").value);
    const date = $("editDate").value;
    if (!item || !title || !Number.isFinite(amount) || amount < 0 || !date) { flash("Check description, amount, and date", true); return; }
    await putExpense({ ...item, title, amount, date });
    addMonth(date.slice(0, 7));
    editDialog.close();
    await refresh();
    updateSummary(date.slice(0, 7));
    flash("Saved");
  });
  $("deleteExpense").addEventListener("click", async () => {
    const idValue = $("editId").value;
    if (!confirm("Delete this expense from this device?")) return;
    await deleteExpense(idValue);
    editDialog.close();
    await refresh();
    flash("Deleted");
  });
  $("menuButton").addEventListener("click", () => {
    $("autopayInput").value = settings.autopay;
    settingsDialog.showModal();
  });
  $("saveSettings").addEventListener("click", () => {
    const value = Number($("autopayInput").value);
    if (!Number.isFinite(value) || value < 0) { flash("Enter a valid autopay amount", true); return; }
    settings.autopay = value;
    saveSettings();
    settingsDialog.close();
    render();
    flash("Saved");
  });
  function exportBackup() {
    const payload = { app: "Notes-style Expenses", version: 2, exportedAt: new Date().toISOString(), settings, expenses };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `expenses-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    flash("Backup exported");
  }
  $("backupButton").addEventListener("click", exportBackup);
  $("restoreButton").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.expenses)) throw new Error("Invalid backup");
      if (!confirm(`Import ${data.expenses.length} expenses? Matching IDs will be replaced; other entries remain.`)) return;
      for (const item of data.expenses) {
        if (item && item.id && typeof item.title === "string" && Number.isFinite(Number(item.amount)) && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) await putExpense({
  id: item.id,
  title: item.title,
  amount: Number(item.amount),
  paymentType: item.paymentType === "cash" ? "cash" : "bank",
  date: item.date,
  createdAt: item.createdAt || Date.now()
});
      }
      if (data.settings) { settings = { ...settings, ...data.settings, months: [...new Set([...(settings.months || []), ...(data.settings.months || [])])] }; saveSettings(); }
      await refresh(); settingsDialog.close(); flash("Backup imported");
    } catch (_) { flash("Invalid backup file", true); }
    finally { event.target.value = ""; }
  });
  async function init() {
    loadSettings();
    try {
      db = await openDB();
      expenses = await getAll();
      // Ensure any month containing existing data is retained as a visible heading.
      expenses.forEach(e => { const m = e.date.slice(0, 7); if (!settings.months.includes(m)) settings.months.push(m); });
      saveSettings();
      $("loading")?.remove();
      render();
    } catch (error) {
      console.error(error);
      list.innerHTML = '<div class="empty-month">Local storage unavailable. Reload the app.</div>';
      flash("Storage unavailable", true);
    }
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./service-worker.js").catch(err => console.warn(err));
  }
  init();
})();
