/*
  App logic for admin dashboard.
  - Listens to Firebase Realtime Database (Orders node)
  - Applies status filter
  - Shows quick stats
  - Allows status updates
  - Shows modal with order items
*/

const ORDER_STATUSES = ["Pending", "Preparing", "Served", "Paid"];
const STATUS_CLASS = {
  Pending: "badge--pending",
  Preparing: "badge--preparing",
  Served: "badge--served",
  Paid: "badge--paid",
};

const ui = {
  navButtons: document.querySelectorAll(".nav-btn"),
  pageTitle: document.getElementById("page-title"),
  pageSubtitle: document.getElementById("page-subtitle"),
  mainAction: document.getElementById("main-action"),
  filterSelect: document.getElementById("filter-status"),
  ordersRoot: document.getElementById("orders-root"),
  staffRoot: document.getElementById("staff-root"),
  tableRoot: document.getElementById("table-root"),
  statsTotal: document.getElementById("stat-total"),
  statsPending: document.getElementById("stat-pending"),
  statsPreparing: document.getElementById("stat-preparing"),
  statsServed: document.getElementById("stat-served"),
  statsPaid: document.getElementById("stat-paid"),
  modalBackdrop: document.getElementById("modal-backdrop"),
  modalTitle: document.getElementById("modal-title"),
  modalContent: document.getElementById("modal-content"),
  modalCloseButtons: document.querySelectorAll("#modal-close, #modal-close-2"),
  modalSaveButton: document.getElementById("modal-save"),
  modalOrderMeta: document.getElementById("modal-order-meta"),
};

let currentView = "orders";
let currentOrders = {}; // map id->order
let currentStaff = {};
let currentTables = {};
let currentFilter = "All";

function formatTimestamp(ms) {
  if (!ms) return "-";
  const date = new Date(ms);
  return date.toLocaleString();
}

function parseCurrency(value) {
  if (typeof value !== "string") return NaN;
  const num = parseFloat(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(num) ? num : NaN;
}

function formatCurrency(value) {
  const num = typeof value === "number" ? value : parseCurrency(value);
  if (Number.isNaN(num)) return value ?? "";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(num);
}

function buildBadge(status) {
  const span = document.createElement("span");
  span.className = `badge ${STATUS_CLASS[status] || ""}`;
  span.textContent = status;
  return span;
}

function updateStats(orders) {
  const counts = {
    Pending: 0,
    Preparing: 0,
    Served: 0,
    Paid: 0,
  };

  Object.values(orders).forEach((order) => {
    const status = order.status || "Pending";
    if (counts[status] !== undefined) {
      counts[status] += 1;
    }
  });

  const total = Object.keys(orders).length;
  ui.statsTotal.textContent = total;
  ui.statsPending.textContent = counts.Pending;
  ui.statsPreparing.textContent = counts.Preparing;
  ui.statsServed.textContent = counts.Served;
  ui.statsPaid.textContent = counts.Paid;
}

function setView(view) {
  currentView = view;
  ui.navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  updatePageHeader();

  if (view === "orders") renderOrders(currentOrders);
  if (view === "staff") renderStaff(currentStaff);
  if (view === "tables") renderTables(currentTables);
}

function updatePageHeader() {
  const presets = {
    orders: {
      title: "Quản lý Đơn hàng",
      subtitle: "Xem, cập nhật trạng thái và thống kê đơn hàng",
    },
    staff: {
      title: "Quản lý nhân viên",
      subtitle: "Thêm, sửa, xóa nhân viên",
    },
    tables: {
      title: "Quản lý bàn",
      subtitle: "Quản lý trạng thái bàn trống / có khách",
    },
  };

  const config = presets[currentView] || presets.orders;
  ui.pageTitle.textContent = config.title;
  ui.pageSubtitle.textContent = config.subtitle;
}

function getStatusClass(status) {
  return STATUS_CLASS[status] || "";
}

function renderOrders(orders) {
  currentOrders = orders || {};
  updateStats(currentOrders);

  const orderEntries = Object.entries(currentOrders);
  if (orderEntries.length === 0) {
    ui.ordersRoot.innerHTML = "<div class=\"empty\">Không có đơn hàng nào.</div>";
    return;
  }

  const filtered = orderEntries.filter(([id, order]) => {
    if (!order) return false;
    if (currentFilter === "All") return true;
    return order.status === currentFilter;
  });

  // Sort by timestamp descending (most recent first)
  filtered.sort(([, a], [, b]) => {
    const ta = Number(a.timestamp) || 0;
    const tb = Number(b.timestamp) || 0;
    return tb - ta;
  });

  ui.ordersRoot.innerHTML = "";

  filtered.forEach(([id, order]) => {
    const card = document.createElement("article");
    card.className = "order-card";

    const header = document.createElement("div");
    header.className = "order-header";

    const title = document.createElement("h2");
    title.textContent = order.tableCode || "-";
    header.appendChild(title);

    const badge = buildBadge(order.status || "Pending");
    header.appendChild(badge);

    card.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "order-meta";

    const ts = document.createElement("span");
    ts.textContent = `Thời gian: ${formatTimestamp(order.timestamp)}`;
    meta.appendChild(ts);

    const staffInfo = document.createElement("span");
    staffInfo.textContent = `Nhân viên: ${order.staffEmail || "-"}`;
    meta.appendChild(staffInfo);

    const total = document.createElement("span");
    total.textContent = `Tổng: ${formatCurrency(order.totalPrice)}`;
    meta.appendChild(total);

    card.appendChild(meta);

    const footer = document.createElement("div");
    footer.className = "order-footer";

    const select = document.createElement("select");
    select.setAttribute("aria-label", "Cập nhật trạng thái");

    ORDER_STATUSES.forEach((status) => {
      const opt = document.createElement("option");
      opt.value = status;
      opt.textContent = status;
      if (status === order.status) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    select.addEventListener("change", () => {
      const newStatus = select.value;
      if (!id) return;
      const updateRef = firebase.database().ref(`Orders/${id}`);
      updateRef.update({ status: newStatus }).then(() => {
        // If status changed to Paid, check if all orders for this table are Paid, then set table to Available
        if (newStatus === "Paid" && order.tableCode) {
          const tableCode = order.tableCode;
          const allOrdersForTable = Object.values(currentOrders).filter(o => o && o.tableCode === tableCode);
          const allPaid = allOrdersForTable.every(o => o.status === "Paid");
          if (allPaid) {
            firebase.database().ref(`Tables/${tableCode}`).update({ status: "Available" });
          }
        }
      }).catch((err) => {
        console.error("Không thể cập nhật trạng thái:", err);
        alert("Có lỗi khi cập nhật trạng thái. Vui lòng thử lại.");
        select.value = order.status || "Pending";
      });
    });

    footer.appendChild(select);

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.textContent = "Xem chi tiết";
    detailBtn.addEventListener("click", () => openOrderModal(id, order));
    footer.appendChild(detailBtn);

    card.appendChild(footer);
    ui.ordersRoot.appendChild(card);
  });

  if (filtered.length === 0) {
    ui.ordersRoot.innerHTML = "<div class=\"empty\">Không tìm thấy đơn hàng phù hợp với bộ lọc.</div>";
  }
}

function renderStaff(staff) {
  currentStaff = staff || {};
  const entries = Object.entries(currentStaff);
  if (entries.length === 0) {
    ui.staffRoot.innerHTML = "<div class=\"empty\">Chưa có nhân viên nào.</div>";
    return;
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  head.innerHTML = `
    <tr>
      <th>Tên</th>
      <th>Email</th>
      <th>Vai trò</th>
      <th>Hành động</th>
    </tr>
  `;
  table.appendChild(head);

  const body = document.createElement("tbody");
  entries.forEach(([id, user]) => {
    const row = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = user.name || "-";
    row.appendChild(nameTd);

    const emailTd = document.createElement("td");
    emailTd.textContent = user.email || "-";
    row.appendChild(emailTd);

    const roleTd = document.createElement("td");
    roleTd.textContent = user.role || "-";
    row.appendChild(roleTd);

    const actionTd = document.createElement("td");
    const editBtn = document.createElement("button");
    editBtn.textContent = "Sửa";
    editBtn.addEventListener("click", () => openStaffForm(id, user));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Xóa";
    deleteBtn.addEventListener("click", () => {
      if (!confirm("Xóa nhân viên này?")) return;
      firebase.database().ref(`Staff/${id}`).remove();
    });

    actionTd.appendChild(editBtn);
    actionTd.appendChild(deleteBtn);
    row.appendChild(actionTd);

    body.appendChild(row);
  });

  table.appendChild(body);
  ui.staffRoot.innerHTML = "";
  ui.staffRoot.appendChild(table);
}

function renderTables(tables) {
  currentTables = tables || {};
  const entries = Object.entries(currentTables);
  if (entries.length === 0) {
    ui.tableRoot.innerHTML = "<div class=\"empty\">Chưa có bàn nào.</div>";
    return;
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  head.innerHTML = `
    <tr>
      <th>Mã bàn</th>
      <th>Trạng thái</th>
      <th>Hành động</th>
    </tr>
  `;
  table.appendChild(head);

  const body = document.createElement("tbody");
  entries.forEach(([id, tableData]) => {
    const row = document.createElement("tr");

    const codeTd = document.createElement("td");
    codeTd.textContent = id; // Table code is now the key
    row.appendChild(codeTd);

    const statusTd = document.createElement("td");
    statusTd.textContent = tableData.status === "Occupied" ? "Có khách" : "Trống";
    row.appendChild(statusTd);

    const actionTd = document.createElement("td");
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = tableData.status === "Occupied" ? "Đặt trống" : "Đặt có khách";
    toggleBtn.addEventListener("click", () => {
      const nextStatus = tableData.status === "Occupied" ? "Available" : "Occupied";
      firebase.database().ref(`Tables/${id}`).update({ status: nextStatus });
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Xóa";
    deleteBtn.addEventListener("click", () => {
      if (!confirm("Xóa bàn này?")) return;
      firebase.database().ref(`Tables/${id}`).remove();
    });

    actionTd.appendChild(toggleBtn);
    actionTd.appendChild(deleteBtn);
    row.appendChild(actionTd);

    body.appendChild(row);
  });

  table.appendChild(body);
  ui.tableRoot.innerHTML = "";
  ui.tableRoot.appendChild(table);
}

function openStaffForm(id, staff = {}) {
  const isEdit = Boolean(id);
  const title = isEdit ? "Sửa nhân viên" : "Thêm nhân viên mới";

  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label>Tên</label>
      <input type="text" name="name" value="${staff.name || ""}" required />
    </div>
    <div class="form-group">
      <label>Email</label>
      <input type="email" name="email" value="${staff.email || ""}" required />
    </div>
    <div class="form-group">
      <label>Mật khẩu</label>
      <input type="password" name="password" value="" ${isEdit ? "" : "required"} placeholder="Để trống nếu không đổi" />
    </div>
    <div class="form-group">
      <label>Vai trò</label>
      <input type="text" name="role" value="${staff.role || ""}" placeholder="Ví dụ: waiter, manager" />
    </div>
  `;

  const onSave = () => {
    const formData = new FormData(form);
    const payload = {
      name: formData.get("name").trim(),
      email: formData.get("email").trim(),
      role: formData.get("role").trim(),
    };

    const password = formData.get("password").trim();
    if (password) {
      payload.password = password;
    }

    if (!payload.name || !payload.email || (!isEdit && !payload.password)) {
      alert("Vui lòng nhập tên, email và mật khẩu.");
      return;
    }

    const ref = id ? firebase.database().ref(`Staff/${id}`) : firebase.database().ref("Staff").push();
    ref.set(payload).then(closeModal).catch((err) => {
      console.error("Lưu nhân viên thất bại", err);
      alert("Không thể lưu nhân viên. Vui lòng thử lại.");
    });
  };

  showModal({ title, content: form, onSave });
}

function openTableForm(id, tableData = {}) {
  const isEdit = Boolean(id);
  const title = isEdit ? "Sửa bàn" : "Thêm bàn mới";

  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label>Mã bàn</label>
      <input type="text" name="code" value="${tableData.code || ""}" required />
    </div>
    <div class="form-group">
      <label>Trạng thái</label>
      <select name="status">
        <option value="Available" ${tableData.status === "Available" ? "selected" : ""}>Trống</option>
        <option value="Occupied" ${tableData.status === "Occupied" ? "selected" : ""}>Có khách</option>
      </select>
    </div>
  `;

  const onSave = () => {
    const formData = new FormData(form);
    const payload = {
      code: formData.get("code").trim(),
      status: formData.get("status"),
    };

    if (!payload.code) {
      alert("Vui lòng nhập mã bàn.");
      return;
    }

    if (id) {
      // For editing existing table (if implemented)
      const ref = firebase.database().ref(`Tables/${id}`);
      ref.set(payload).then(closeModal).catch((err) => {
        console.error("Lưu bàn thất bại", err);
        alert("Không thể lưu bàn. Vui lòng thử lại.");
      });
    } else {
      // For adding new table, use table code as key
      const tableCode = payload.code;
      firebase.database().ref(`Tables/${tableCode}`).set({ status: payload.status }).then(closeModal).catch((err) => {
        console.error("Lưu bàn thất bại", err);
        alert("Không thể lưu bàn. Vui lòng thử lại.");
      });
    }
  };

  showModal({ title, content: form, onSave });
}

function showModal({ title, meta = "", content, onSave } = {}) {
  ui.modalTitle.textContent = title || "";
  ui.modalOrderMeta.textContent = meta || "";

  ui.modalContent.innerHTML = "";
  if (typeof content === "string") {
    ui.modalContent.innerHTML = content;
  } else if (content instanceof Node) {
    ui.modalContent.appendChild(content);
  } else if (Array.isArray(content)) {
    content.forEach((node) => {
      if (node instanceof Node) ui.modalContent.appendChild(node);
    });
  }

  ui.modalSaveButton.style.display = typeof onSave === "function" ? "inline-flex" : "none";
  ui.modalSaveButton._onSave = onSave;
  ui.modalBackdrop.style.display = "flex";
}

function openOrderModal(id, order) {
  if (!order) return;

  const meta = `Mã đơn: ${id} · Trạng thái: ${order.status || "-"}${
    order.staffEmail ? " · Nhân viên: " + order.staffEmail : ""
  }`;

  const content = document.createElement("div");
  const items = Array.isArray(order.items) ? order.items : [];

  if (items.length === 0) {
    content.innerHTML = "<p>Không có món hàng nào trong đơn này.</p>";
  } else {
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "item";

      const metaNode = document.createElement("div");
      metaNode.className = "meta";

      const name = document.createElement("strong");
      name.textContent = item.name || "-";
      metaNode.appendChild(name);

      const qty = document.createElement("span");
      qty.textContent = `Số lượng: ${item.quantity ?? "-"}`;
      metaNode.appendChild(qty);

      row.appendChild(metaNode);

      const price = document.createElement("div");
      price.style.textAlign = "right";
      price.style.whiteSpace = "nowrap";
      price.textContent = formatCurrency(item.price);
      row.appendChild(price);

      content.appendChild(row);
    });
  }

  showModal({ title: `Đơn ${order.tableCode || id}`, meta, content });
}

function closeModal() {
  ui.modalBackdrop.style.display = "none";
  ui.modalSaveButton._onSave = null;
}

function setupListeners() {
  ui.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  ui.filterSelect.addEventListener("change", (e) => {
    currentFilter = e.target.value;
    renderOrders(currentOrders);
  });

  const addStaffBtn = document.getElementById("btn-add-staff");
  const addTableBtn = document.getElementById("btn-add-table");
  addStaffBtn?.addEventListener("click", () => openStaffForm());
  addTableBtn?.addEventListener("click", () => openTableForm());

  ui.modalSaveButton.addEventListener("click", () => {
    if (typeof ui.modalSaveButton._onSave === "function") {
      ui.modalSaveButton._onSave();
    }
  });

  ui.modalCloseButtons.forEach((btn) => btn.addEventListener("click", closeModal));
  ui.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === ui.modalBackdrop) {
      closeModal();
    }
  });
}

function initFirebaseListeners() {
  const ordersRef = firebase.database().ref("Orders");
  ordersRef.on("value", (snapshot) => {
    const data = snapshot.val() || {};
    renderOrders(data);
  });

  const staffRef = firebase.database().ref("Staff");
  staffRef.on("value", (snapshot) => {
    const data = snapshot.val() || {};
    renderStaff(data);
  });

  const tablesRef = firebase.database().ref("Tables");
  tablesRef.on("value", (snapshot) => {
    const data = snapshot.val() || {};
    renderTables(data);
  });

  // Optional: handle connection errors
  ordersRef.on("cancel", (error) => {
    console.error("Firebase listener canceled", error);
  });
  staffRef.on("cancel", (error) => {
    console.error("Firebase listener canceled", error);
  });
  tablesRef.on("cancel", (error) => {
    console.error("Firebase listener canceled", error);
  });
}

function init() {
  setupListeners();
  setView(currentView);
  initFirebaseListeners();
}

window.addEventListener("DOMContentLoaded", init);
