/* Offline-first expense list. All records remain in this browser's local IndexedDB. */
(() => {
  "use strict";
  const DB_NAME = "notes-style-expenses";
  const DB_VERSION = 1;
  const STORE = "expenses";
  const SETTINGS_KEY = "settings";
  const $ = (id) => document.getElementById(id);
  const form = $("expenseForm");
  const input = $("expenseInput");
  const list = $("notesList");
  const summaryMonth = $("summaryMonth");
  const summaryTotal = $("summaryTotal");
  const summarySubtitle = $("summarySubtitle");
  const status = $("status");
  const settingsDialog = $("settingsDialog");
  const editDialog = $("editDialog");
  let db;
  let expenses = [];
  let settings = { autopay: 430, startMonth: "" };
  let activeMonth = "";
  let observer;
  let statusTimer;

  const money = (value) => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const monthLabel = (key) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
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
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch (error) { console.error("Could not save settings", error); }
  }
  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      settings = { ...settings, ...stored };
    } catch (_) {}
  }
  function flash(message, isError = false) {
    status.textContent = message;
    status.style.color = isError ? "#ff8d94" : "#70d7a1";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ""; }, 3000);
  }

  // Accepts "Speakers. 2800", "Bought keyboard 2800", and "Coffee. ₹250".
  function parseEntry(raw) {
    const text = raw.trim();
    if (!text) return null;
    const match = text.match(/^(.*?)(?:\s*[.·]\s*|\s+)(?:₹\s*)?(-?\d[\d,]*(?:\.\d{1,2})?)\s*$/);
    if (!match) return { title: text, amount: null };
    const title = match[1].trim().replace(/[.·]\s*$/, "").trim();
    const amount = Number(match[2].replace(/,/g, ""));
    if (!title || !Number.isFinite(amount) || amount < 0) return null;
    return { title, amount };
  }

  function getMonths() {
    const monthSet = new Set(expenses.map(e => e.date.slice(0, 7)));
    const current = monthKey(new Date());
    monthSet.add(current);
    if (settings.startMonth) monthSet.add(settings.startMonth);
    const all = [...monthSet].filter(Boolean).sort();
    if (settings.startMonth) {
      const end = all[all.length - 1] || current;
      let cursor = settings.startMonth;
      const [ey, em] = end.split("-").map(Number);
      let safety = 0;
      while (cursor <= end && safety++ < 240) {
        monthSet.add(cursor);
        const [y, m] = cursor.split("-").map(Number);
        const next = new Date(y, m, 1);
        cursor = monthKey(next);
      }
    }
    return [...monthSet].sort();
  }
  function sumForMonth(key) {
    return expenses.filter(e => e.date.slice(0, 7) === key).reduce((sum, e) => sum + Number(e.amount || 0), 0) + Number(settings.autopay || 0);
  }
  function updateSummary(key) {
    if (!key) return;
    activeMonth = key;
    summaryMonth.textContent = monthLabel(key);
    summaryTotal.textContent = money(sumForMonth(key));
    summarySubtitle.textContent = `Monthly total · includes ${money(settings.autopay)} autopay`;
    document.title = `${monthLabel(key)} · ${money(sumForMonth(key))}`;
  }

  function render() {
    const months = getMonths().reverse();
    list.replaceChildren();
    if (observer) observer.disconnect();
    if (!months.length) {
      list.innerHTML = '<div class="empty-month">No expenses yet. Add one above.</div>';
      return;
    }
    months.forEach(key => {
      const section = document.createElement("section");
      section.className = "month-section";
      section.dataset.month = key;
      const heading = document.createElement("h2");
      heading.className = "month-heading";
      heading.textContent = monthLabel(key);
      section.appendChild(heading);

      const monthExpenses = expenses.filter(e => e.date.slice(0, 7) === key)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
      if (!monthExpenses.length) {
        const empty = document.createElement("div");
        empty.className = "empty-month";
        empty.textContent = "No expenses recorded";
        section.appendChild(empty);
      } else {
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
      }
      const monthTotal = document.createElement("div");
      monthTotal.className = "month-total-line";
      monthTotal.textContent = `Total including autopay: ${money(sumForMonth(key))}`;
      section.appendChild(monthTotal);
      list.appendChild(section);
    });

    observer = new IntersectionObserver((entries) => {
      const candidates = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top - 210) - Math.abs(b.boundingClientRect.top - 210));
      if (candidates[0]) updateSummary(candidates[0].target.dataset.month);
    }, { root: null, rootMargin: "-190px 0px -60% 0px", threshold: [0, 0.01, 0.2] });
    list.querySelectorAll(".month-section").forEach(section => observer.observe(section));
    const now = monthKey(new Date());
    updateSummary(months.includes(now) ? now : months[0]);
  }

  async function refresh() {
    expenses = await getAll();
    expenses.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    render();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = parseEntry(input.value);
    if (!parsed) { flash("Enter a description and amount, e.g. Speakers. 2800", true); return; }
    if (parsed.amount === null) {
      flash("I couldn't find an amount. Try: Speakers. 2800", true);
      return;
    }
    const now = new Date();
    const item = { id: id(), title: parsed.title, amount: parsed.amount, date: dateKey(now), createdAt: Date.now() };
    try {
      await putExpense(item);
      input.value = "";
      await refresh();
      updateSummary(monthKey(now));
      flash("Saved on this device");
      input.focus();
    } catch (_) { flash("Could not save this entry. Export a backup and try again.", true); }
  });

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
    if (!item || !title || !Number.isFinite(amount) || amount < 0 || !date) { flash("Check the description, amount, and date.", true); return; }
    await putExpense({ ...item, title, amount, date });
    editDialog.close();
    await refresh();
    flash("Changes saved");
  });
  $("deleteExpense").addEventListener("click", async () => {
    const idValue = $("editId").value;
    if (!confirm("Delete this expense permanently from this device?")) return;
    await deleteExpense(idValue);
    editDialog.close();
    await refresh();
    flash("Expense deleted");
  });

  $("menuButton").addEventListener("click", () => {
    $("autopayInput").value = settings.autopay;
    $("startMonth").value = settings.startMonth || "";
    settingsDialog.showModal();
  });
  $("saveSettings").addEventListener("click", () => {
    const value = Number($("autopayInput").value);
    if (!Number.isFinite(value) || value < 0) { flash("Enter a valid autopay amount.", true); return; }
    settings.autopay = value;
    settings.startMonth = $("startMonth").value || "";
    saveSettings();
    settingsDialog.close();
    render();
    flash("Settings saved");
  });

  function exportBackup() {
    const payload = { app: "Notes-style Expenses", version: 1, exportedAt: new Date().toISOString(), settings, expenses };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-backup-${dateKey(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash("Backup export started");
  }
  $("backupButton").addEventListener("click", exportBackup);
  $("restoreButton").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.expenses)) throw new Error("Invalid backup");
      if (!confirm(`Import ${data.expenses.length} expenses? Existing entries with matching IDs will be replaced; other entries will remain.`)) return;
      for (const item of data.expenses) {
        if (item && item.id && typeof item.title === "string" && Number.isFinite(Number(item.amount)) && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
          await putExpense({ id: item.id, title: item.title, amount: Number(item.amount), date: item.date, createdAt: item.createdAt || Date.now() });
        }
      }
      if (data.settings) { settings = { ...settings, ...data.settings }; saveSettings(); }
      await refresh();
      settingsDialog.close();
      flash("Backup imported");
    } catch (_) { flash("That file doesn't look like a valid app backup.", true); }
    finally { event.target.value = ""; }
  });

  async function init() {
    loadSettings();
    try {
      db = await openDB();
      await refresh();
      $("loading")?.remove();
      $("storageStatus").textContent = "Saved on this device";
    } catch (error) {
      console.error(error);
      list.innerHTML = '<div class="empty-month">Local storage could not be opened. Please use a modern browser and reload.</div>';
      flash("Storage unavailable", true);
    }
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./service-worker.js").catch(err => console.warn("Offline setup unavailable", err));
    }
  }
  init();
})();
