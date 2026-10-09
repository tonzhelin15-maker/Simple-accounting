"use strict";

/* Simple Accounting web app. One clean handler is registered for each control. */
const STORAGE_KEY = "simpleLedgerWeb.v2";
const LEGACY_KEY = "simpleLedgerWeb.v1";
let state = readState();
let view = "month";
let cursor = new Date();
let editingId = null;
let calendarExpanded = true;

function defaultState() {
  return {
    accounts: [
      { id: "wallet", name: "錢包", kind: "wallet", openingBalance: 0 },
      { id: "bank", name: "銀行帳戶", kind: "bank", openingBalance: 0 }
    ],
    transactions: []
  };
}

function readState() {
  for (const key of [STORAGE_KEY, LEGACY_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && Array.isArray(saved.accounts) && Array.isArray(saved.transactions)) {
        return { accounts: saved.accounts, transactions: saved.transactions };
      }
    } catch (_) {}
  }
  return defaultState();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>\"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
  }[char]));
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("zh-TW")} 元`;
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPeriod() {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const day = cursor.getDate();

  if (view === "day") {
    return {
      start: new Date(year, month, day),
      end: new Date(year, month, day + 1),
      label: cursor.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" })
    };
  }
  if (view === "year") {
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), label: `${year} 年` };
  }
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 1),
    label: cursor.toLocaleDateString("zh-TW", { year: "numeric", month: "long" })
  };
}

function getVisibleTransactions() {
  const period = getPeriod();
  return state.transactions
    .filter(transaction => {
      const date = new Date(`${transaction.date}T00:00:00`);
      return date >= period.start && date < period.end;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function render() {
  const transactions = getVisibleTransactions();
  const income = transactions
    .filter(transaction => transaction.kind === "income")
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
  const expense = transactions
    .filter(transaction => transaction.kind === "expense")
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);

  document.querySelector("#periodLabel").textContent = getPeriod().label;
  renderCalendar();
  document.querySelector("#summary").innerHTML = `
    <span>${view === "day" ? "今日" : view === "year" ? "全年" : "本期"}支出</span>
    <strong>${formatMoney(expense)}</strong>
    <span>收入 ${formatMoney(income)}　結餘 ${formatMoney(income - expense)} · ${transactions.length} 筆</span>`;

  const list = document.querySelector("#list");
  if (!transactions.length) {
    list.innerHTML = '<div class="row">這段期間還沒有紀錄</div>';
    return;
  }
  list.innerHTML = transactions.map(transaction => {
    const transferLabel = transaction.kind === "transfer"
      ? ` → ${accountName(transaction.destinationId)}` : "";
    const sign = transaction.kind === "income" ? "+" : transaction.kind === "transfer" ? "↔" : "−";
    return `<div class="row" data-id="${escapeHTML(transaction.id)}">
      <div><b>${escapeHTML(transaction.title)}</b>
      <small>${escapeHTML(transaction.date)} · ${escapeHTML(accountName(transaction.accountId))}${escapeHTML(transferLabel)}</small></div>
      <b class="${escapeHTML(transaction.kind)}">${sign}${formatMoney(transaction.amount)}</b>
    </div>`;
  }).join("");
}

function renderCalendar() {
  const host = document.querySelector("#calendar");
  if (view !== "month") { host.innerHTML = ""; return; }
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysWithEntries = new Set(state.transactions.map(t => {
    const d = new Date(`${t.date}T00:00:00`);
    return d.getFullYear() === year && d.getMonth() === month ? d.getDate() : null;
  }).filter(Boolean));
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
  const cells = weekdayLabels.map(day => `<div class="calendar-weekday">${day}</div>`);
  for (let i = 0; i < firstWeekday; i++) cells.push('<div class="calendar-cell empty"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const selected = cursor.getDate() === day;
    cells.push(`<button type="button" class="calendar-cell${selected ? " selected" : ""}" data-calendar-day="${day}"><span>${day}</span>${daysWithEntries.has(day) ? '<i class="calendar-dot"></i>' : '<i class="calendar-dot hidden"></i>'}</button>`);
  }
  host.innerHTML = `<div class="calendar-heading"><strong>${year}年${month + 1}月</strong><button type="button" id="calendarToggle">${calendarExpanded ? "⌃　收合月曆" : "⌄　展開月曆"}</button></div>${calendarExpanded ? `<div class="calendar-grid">${cells.join("")}</div>` : ""}`;
}

function accountName(id) {
  return state.accounts.find(account => account.id === id)?.name || "未知帳戶";
}

function movePeriod(amount) {
  if (view === "day") {
    cursor.setDate(cursor.getDate() + amount);
  } else if (view === "year") {
    cursor.setFullYear(cursor.getFullYear() + amount);
  } else {
    // Avoid month-end overflow (e.g. Jan 31 moving to Mar 3).
    const desiredDay = cursor.getDate();
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() + amount);
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    cursor.setDate(Math.min(desiredDay, lastDay));
  }
  render();
}

function fillAccountChoices() {
  const options = state.accounts.map(account =>
    `<option value="${escapeHTML(account.id)}">${escapeHTML(account.name)}</option>`
  ).join("");
  document.querySelector("#account").innerHTML = options;
  document.querySelector("#destination").innerHTML = options;
}

function openEditor(transaction = null) {
  editingId = transaction?.id || null;
  fillAccountChoices();
  document.querySelector("#editorTitle").textContent = transaction ? "編輯紀錄" : "新增紀錄";
  document.querySelector("#title").value = transaction?.title || "";
  document.querySelector("#amount").value = transaction?.amount ?? "";
  document.querySelector("#kind").value = transaction?.kind || "expense";
  document.querySelector("#date").value = transaction?.date || toDateInput(cursor);
  document.querySelector("#account").value = transaction?.accountId || state.accounts[0]?.id || "";
  document.querySelector("#destination").value = transaction?.destinationId || state.accounts[1]?.id || state.accounts[0]?.id || "";
  toggleDestination();
  document.querySelector("#editor").showModal();
}

function toggleDestination() {
  document.querySelector("#destination").hidden = document.querySelector("#kind").value !== "transfer";
}

function renderAccounts() {
  document.querySelector("#accountList").innerHTML = state.accounts.map(account => {
    const balance = state.transactions.reduce((total, transaction) => {
      if (transaction.accountId === account.id) {
        if (transaction.kind === "income") return total + Number(transaction.amount);
        if (transaction.kind === "expense") return total - Number(transaction.amount);
      }
      if (transaction.kind === "transfer" && transaction.destinationId === account.id) {
        return total + Number(transaction.amount);
      }
      if (transaction.kind === "transfer" && transaction.accountId === account.id) {
        return total - Number(transaction.amount);
      }
      return total;
    }, Number(account.openingBalance || 0));
    return `<div class="account"><div><b>${escapeHTML(account.name)}</b><small>${escapeHTML(account.kind)}</small></div><b>${formatMoney(balance)}</b></div>`;
  }).join("");
}

// Single handler per view control.
document.querySelectorAll("nav button[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    document.querySelectorAll("nav button[data-view]").forEach(item => item.classList.toggle("active", item === button));
    render();
  });
});
document.querySelector("#prev").addEventListener("click", () => movePeriod(-1));
document.querySelector("#next").addEventListener("click", () => movePeriod(1));
document.querySelector("#calendar").addEventListener("click", event => {
  if (event.target.closest("#calendarToggle")) { calendarExpanded = !calendarExpanded; renderCalendar(); return; }
  const dayButton = event.target.closest("[data-calendar-day]");
  if (!dayButton) return;
  cursor.setDate(Number(dayButton.dataset.calendarDay));
  view = "day";
  document.querySelectorAll("nav button[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === "day"));
  render();
});
document.querySelector("#add").addEventListener("click", () => openEditor());
document.querySelector("#kind").addEventListener("change", toggleDestination);

document.querySelector("#save").addEventListener("click", event => {
  event.preventDefault();
  const transaction = {
    id: editingId || makeId(),
    title: document.querySelector("#title").value.trim(),
    amount: Number(document.querySelector("#amount").value),
    kind: document.querySelector("#kind").value,
    date: document.querySelector("#date").value,
    accountId: document.querySelector("#account").value,
    destinationId: document.querySelector("#destination").value
  };
  if (!transaction.title || !Number.isFinite(transaction.amount) || transaction.amount <= 0 || !transaction.date) return;
  if (transaction.kind === "transfer" && transaction.accountId === transaction.destinationId) {
    alert("轉出帳戶和轉入帳戶不能相同。");
    return;
  }
  state.transactions = editingId
    ? state.transactions.map(item => item.id === editingId ? transaction : item)
    : [...state.transactions, transaction];
  persist();
  document.querySelector("#editor").close();
  render();
});

document.querySelector("#list").addEventListener("click", event => {
  const row = event.target.closest(".row[data-id]");
  if (row) openEditor(state.transactions.find(transaction => transaction.id === row.dataset.id));
});

document.querySelector("#accounts").addEventListener("click", () => {
  renderAccounts();
  document.querySelector("#accountDialog").showModal();
});
document.querySelector("#addAccount").addEventListener("click", event => {
  event.preventDefault();
  const nameField = document.querySelector("#accountName");
  const name = nameField.value.trim();
  if (!name) return;
  state.accounts.push({ id: makeId(), name, kind: document.querySelector("#accountKind").value, openingBalance: 0 });
  nameField.value = "";
  persist();
  renderAccounts();
});

document.querySelector("#export").addEventListener("click", () => {
  const payload = { format: "simple-accounting-web", version: 2, exportedAt: new Date().toISOString(), ...state };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "simple-accounting-backup.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.querySelector("#import").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.accounts) || !Array.isArray(imported.transactions)) throw new Error("資料格式不符");
      state = { accounts: imported.accounts, transactions: imported.transactions };
      persist();
      render();
      alert("匯入完成");
    } catch (_) {
      alert("JSON 格式不正確，未變更目前資料。");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
});

render();
