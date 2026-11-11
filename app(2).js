"use strict";

/* Configuracion
   Pegá aca la URL que te da Google al implementar el Apps Script
   (termina en /exec). */
const API_URL = "PEGAR_AQUI_LA_URL_DE_APPS_SCRIPT";
const REQUEST_TIMEOUT_MS = 15000;
const APP_VERSION = "v3";

const ALL_CATEGORIES = "Todas";
const CART_KEY = "hoja-cart";
const SESSION_KEY = "hoja-admin";

/* Dibujos disponibles para los productos */
const TYPE_LABELS = {
  hojas: "Hojas grandes",
  cactus: "Cactus",
  roseta: "Suculenta",
  colgante: "Colgante",
  espada: "Hojas largas",
  maceta: "Maceta",
  riego: "Riego"
};

/* Catalogo inicial. Se usa mientras no hay conexion con el script. Cuando
   el administrador guarda cambios, el catalogo real vive en Google. */
const DEFAULT_PRODUCTS = [
  { id: 1, name: "Monstera deliciosa", category: "Interior",   price: 18500, type: "hojas",    color: "#2F7D4A", bg: "#DDEBC8", detail: "Maceta 20 cm" },
  { id: 2, name: "Ficus lyrata",       category: "Interior",   price: 32000, type: "hojas",    color: "#3E8E55", bg: "#CFE5D8", detail: "Maceta 24 cm" },
  { id: 3, name: "Cactus cardón",      category: "Suculentas", price: 9800,  type: "cactus",   color: "#4C8A5B", bg: "#F2E3B8", detail: "Maceta 14 cm" },
  { id: 4, name: "Echeveria rosa",     category: "Suculentas", price: 6500,  type: "roseta",   color: "#8AA6A3", bg: "#F0D7DC", detail: "Maceta 10 cm" },
  { id: 5, name: "Potus colgante",     category: "Colgantes",  price: 12400, type: "colgante", color: "#5FA25F", bg: "#E2E8B8", detail: "Con soporte" },
  { id: 6, name: "Cinta colgante",     category: "Colgantes",  price: 8900,  type: "colgante", color: "#79B36A", bg: "#D5E8EE", detail: "Maceta 15 cm" },
  { id: 7, name: "Sansevieria",        category: "Interior",   price: 14300, type: "espada",   color: "#2F6B45", bg: "#E9DDF2", detail: "Maceta 18 cm" },
  { id: 8, name: "Maceta de cerámica", category: "Accesorios", price: 7200,  type: "maceta",   color: "#E9C46A", bg: "#DDEBC8", detail: "Diámetro 16 cm" },
  { id: 9, name: "Kit de riego",       category: "Accesorios", price: 5400,  type: "riego",    color: "#6AA7C9", bg: "#F2E3B8", detail: "Regadera y pulverizador" }
];

/* Estado */
const state = {
  products: DEFAULT_PRODUCTS.map((product) => ({ ...product })),
  category: ALL_CATEGORIES,
  query: "",
  sort: "",            // "", "asc", "desc" o "name"
  cart: loadCart(),    // { [idProducto]: cantidad }
  admin: loadSession(), // { user, token } o null
  editingId: null      // id del producto en edicion, o null si es uno nuevo
};

let toastTimer = null;

/* Utilidades */
const $ = (selector) => document.querySelector(selector);

const formatPrice = (amount) => "$" + amount.toLocaleString("es-AR");

const findProduct = (id) => state.products.find((product) => product.id === id);

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/* Todo texto que carga el administrador se escapa antes de insertarlo en la pagina */
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const safeColor = (value) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#888888");

function readStorage(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null; // Almacenamiento bloqueado o datos dañados
  }
}

function writeStorage(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* Sin almacenamiento: el dato vive solo en memoria */
  }
}

/* Son funciones (no constantes) para poder usarlas antes de esta linea,
   por ejemplo al armar "state" mas arriba. */
function loadCart() {
  return readStorage(localStorage, CART_KEY) || {};
}

function saveCart() {
  writeStorage(localStorage, CART_KEY, state.cart);
}

function loadSession() {
  return readStorage(sessionStorage, SESSION_KEY);
}

function saveSession(session) {
  writeStorage(sessionStorage, SESSION_KEY, session);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2500);
}

/* Cambia un boton a "ocupado" y lo restaura despues */
function setBusy(button, isBusy, busyText) {
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
  } else {
    button.textContent = button.dataset.label || button.textContent;
  }
  button.disabled = isBusy;
}

/* Comunicacion con Google Apps Script */
async function request(url, init) {
  if (!API_URL.startsWith("https://script.google.com/")) {
    const error = new Error("La tienda todavía no está conectada a Google Apps Script. Configurá API_URL en app.js.");
    error.code = "setup";
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const result = await response.json();

    if (!result.ok) {
      const error = new Error(result.error || "El servidor rechazó la solicitud.");
      error.code = result.code || "";
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/* Sin cabecera Content-Type el navegador envia text/plain. Es a proposito:
   asi la peticion es "simple" y Apps Script la acepta sin preflight CORS. */
const apiPost = (payload) => request(API_URL, { method: "POST", body: JSON.stringify(payload) });
const apiGet = (action) => request(`${API_URL}?action=${encodeURIComponent(action)}`);

function describeError(error) {
  const isNetworkProblem = error.name === "AbortError" || error instanceof TypeError;
  return isNetworkProblem
    ? "No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo."
    : error.message;
}

/* Ilustraciones SVG: una funcion por tipo de producto */
const POT = `
  <path d="M30 78h40l-5 20H35z" fill="#C9744D"/>
  <rect x="27" y="72" width="46" height="8" rx="2" fill="#B0623F"/>`;

const DRAWERS = {
  hojas: (c) => `
    <ellipse cx="50" cy="45" rx="14" ry="26" fill="${c}"/>
    <ellipse cx="30" cy="52" rx="12" ry="20" fill="${c}" opacity=".85" transform="rotate(-35 30 52)"/>
    <ellipse cx="70" cy="52" rx="12" ry="20" fill="${c}" opacity=".85" transform="rotate(35 70 52)"/>`,

  cactus: (c) => `
    <rect x="40" y="25" width="20" height="50" rx="10" fill="${c}"/>
    <rect x="24" y="42" width="12" height="22" rx="6" fill="${c}"/>
    <rect x="64" y="36" width="12" height="22" rx="6" fill="${c}"/>`,

  roseta: (c) =>
    [0, 60, 120, 180, 240, 300]
      .map((angle) => `<ellipse cx="50" cy="58" rx="8" ry="18" fill="${c}" transform="rotate(${angle} 50 66)"/>`)
      .join("") + `<circle cx="50" cy="66" r="6" fill="#E9B7C0"/>`,

  colgante: (c) =>
    [-40, -15, 15, 40]
      .map((dx) => `<path d="M50 72Q${50 + dx} 40 ${50 + dx * 1.4} 90" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`)
      .join(""),

  espada: (c) =>
    [-18, 0, 18]
      .map((angle, i) => `<path d="M50 74L${50 + angle * 0.6} ${18 + (i % 2) * 10}L${56 + angle * 0.6} 74z" fill="${c}" transform="rotate(${angle} 50 74)"/>`)
      .join(""),

  maceta: (c) => `
    <path d="M22 40h56l-8 52H30z" fill="${c}"/>
    <rect x="18" y="32" width="64" height="12" rx="3" fill="${c}" opacity=".8"/>`,

  riego: (c) => `
    <rect x="26" y="46" width="42" height="42" rx="8" fill="${c}"/>
    <path d="M68 56L90 38" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <path d="M26 58Q12 56 16 40" stroke="${c}" stroke-width="6" fill="none"/>`
};

/* Tipos que se dibujan dentro de una maceta */
const POTTED_TYPES = new Set(["hojas", "cactus", "roseta", "colgante", "espada"]);

function plantSvg(type, color) {
  const draw = DRAWERS[type] || DRAWERS.hojas;
  const pot = POTTED_TYPES.has(type) ? POT : "";
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${draw(safeColor(color))}${pot}</svg>`;
}

/* Catalogo: filtros y render */
function getVisibleProducts() {
  const query = state.query.trim().toLowerCase();

  const list = state.products.filter((product) => {
    const matchesCategory = state.category === ALL_CATEGORIES || product.category === state.category;
    return matchesCategory && product.name.toLowerCase().includes(query);
  });

  if (state.sort === "asc") list.sort((a, b) => a.price - b.price);
  if (state.sort === "desc") list.sort((a, b) => b.price - a.price);
  if (state.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "es"));

  return list;
}

function renderChips() {
  const categories = [...new Set(state.products.map((product) => product.category))];
  if (state.category !== ALL_CATEGORIES && !categories.includes(state.category)) {
    state.category = ALL_CATEGORIES; // La categoria elegida ya no existe
  }

  $("#chips").innerHTML = [ALL_CATEGORIES, ...categories]
    .map((category) => `
      <button type="button" class="chip" data-action="category" data-category="${escapeHtml(category)}"
              aria-pressed="${category === state.category}">${escapeHtml(category)}</button>`)
    .join("");

  $("#category-list").innerHTML = categories
    .map((category) => `<option value="${escapeHtml(category)}"></option>`)
    .join("");
}

function productCardHtml(product) {
  const adminActions = state.admin
    ? `<div class="admin-actions">
         <button type="button" data-action="edit" data-id="${product.id}">Editar</button>
         <button type="button" class="danger" data-action="delete" data-id="${product.id}">Eliminar</button>
       </div>`
    : "";

  return `
    <article class="card">
      <div class="card-image" style="background:${safeColor(product.bg)}">${plantSvg(product.type, product.color)}</div>
      <div class="card-body">
        <small>${escapeHtml(product.category)}</small>
        <h3>${escapeHtml(product.name)}</h3>
        <small>${escapeHtml(product.detail || "")}</small>
        <div class="card-footer">
          <span class="price">${formatPrice(product.price)}</span>
          <button type="button" class="add" data-action="add" data-id="${product.id}">Agregar</button>
        </div>
        ${adminActions}
      </div>
    </article>`;
}

function renderGrid() {
  const products = getVisibleProducts();

  $("#grid").innerHTML = products.length
    ? products.map(productCardHtml).join("")
    : `<p class="empty">No encontramos plantas con ese nombre. Probá con otra palabra.</p>`;
}

/* Vuelve a dibujar todo lo que depende del catalogo */
function refreshCatalog() {
  renderChips();
  renderGrid();
  renderCart();
}

/* Carrito */
function getCartLines() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({ product: findProduct(Number(id)), quantity }))
    .filter((line) => line.product);
}

const getCartTotal = (lines) => lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
const getCartCount = (lines) => lines.reduce((sum, line) => sum + line.quantity, 0);

function changeQuantity(id, delta) {
  const next = Math.max(0, (state.cart[id] || 0) + delta);

  if (next === 0) delete state.cart[id];
  else state.cart[id] = next;

  saveCart();
  renderCart();
}

function removeFromCart(id) {
  delete state.cart[id];
  saveCart();
  renderCart();
}

function cartLineHtml({ product, quantity }) {
  return `
    <div class="cart-line">
      <div class="cart-thumb" style="background:${safeColor(product.bg)}">${plantSvg(product.type, product.color)}</div>
      <div>
        <b>${escapeHtml(product.name)}</b>
        <div class="qty">
          <button type="button" data-action="decrease" data-id="${product.id}" aria-label="Quitar uno">-</button>
          <span>${quantity}</span>
          <button type="button" data-action="increase" data-id="${product.id}" aria-label="Agregar uno">+</button>
        </div>
      </div>
      <div class="cart-subtotal">
        <div>${formatPrice(product.price * quantity)}</div>
        <button type="button" class="remove" data-action="remove" data-id="${product.id}">Quitar</button>
      </div>
    </div>`;
}

function renderCart() {
  const lines = getCartLines();
  const count = getCartCount(lines);

  $("#cart-items").innerHTML = lines.length
    ? lines.map(cartLineHtml).join("")
    : `<p class="empty">Tu carrito está vacío. Agregá una planta para empezar.</p>`;

  $("#cart-total").textContent = formatPrice(getCartTotal(lines));
  $("#cart-count").textContent = count;
  $("#pay").disabled = count === 0;
}

function setCartOpen(isOpen) {
  $("#cart").classList.toggle("is-open", isOpen);
  $("#scrim").classList.toggle("is-open", isOpen);
  $("#cart").inert = !isOpen;

  // Mueve el foco para que el teclado no se pierda
  (isOpen ? $("#close-cart") : $("#open-cart")).focus();
}

/* Pedido: formulario y envio */
const checkoutDialog = $("#checkout");
const checkoutForm = $("#checkout-form");
const formStatus = $("#form-status");
const submitButton = $("#submit-order");

function openCheckout() {
  const lines = getCartLines();
  if (lines.length === 0) return;

  setCartOpen(false);
  formStatus.textContent = "";
  $("#checkout-summary").textContent =
    `${getCartCount(lines)} producto(s). Total: ${formatPrice(getCartTotal(lines))}`;
  checkoutDialog.showModal();
}

function buildOrder(formData) {
  const lines = getCartLines();
  const text = (field) => String(formData.get(field) || "").trim();

  return {
    action: "order",
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    items: lines.map(({ product, quantity }) => ({ id: product.id, quantity })),
    createdAt: new Date().toISOString()
  };
}

async function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(checkoutForm);
  if (formData.get("website")) return; // Campo trampa completado: es un bot

  if (getCartLines().length === 0) {
    formStatus.textContent = "El carrito está vacío.";
    return;
  }

  setBusy(submitButton, true, "Enviando...");
  formStatus.textContent = "";

  try {
    await apiPost(buildOrder(formData));

    state.cart = {};
    saveCart();
    renderCart();
    checkoutForm.reset();
    checkoutDialog.close();
    showToast("Pedido enviado. Te vamos a contactar para coordinar la entrega.");
  } catch (error) {
    formStatus.textContent = describeError(error);
  } finally {
    setBusy(submitButton, false);
  }
}

/* Administrador: sesion */
const loginDialog = $("#login-dialog");
const loginForm = $("#login-form");
const loginStatus = $("#login-status");
const loginSubmit = $("#login-submit");

function renderSession() {
  const admin = state.admin;

  $("#login-button").hidden = Boolean(admin);
  $("#logout-button").hidden = !admin;
  $("#add-product").hidden = !admin;
  $("#admin-badge").hidden = !admin;
  if (admin) $("#admin-badge").textContent = "Administrador: " + admin.user;
}

function openLogin() {
  loginStatus.textContent = "";
  loginDialog.showModal();
}

function clearSession() {
  state.admin = null;
  saveSession(null);
  renderSession();
  renderGrid();
}

async function handleLogin(event) {
  event.preventDefault();

  const formData = new FormData(loginForm);
  setBusy(loginSubmit, true, "Ingresando...");
  loginStatus.textContent = "";

  try {
    const result = await apiPost({
      action: "login",
      username: String(formData.get("username")).trim(),
      password: String(formData.get("password"))
    });

    state.admin = { user: result.user, token: result.token };
    saveSession(state.admin);
    loginDialog.close();
    renderSession();
    renderGrid();
    showToast("Sesión iniciada");
  } catch (error) {
    loginStatus.textContent = describeError(error);
  } finally {
    setBusy(loginSubmit, false);
  }
}

async function logout() {
  const token = state.admin && state.admin.token;
  clearSession();
  showToast("Sesión cerrada");

  if (token) {
    try {
      await apiPost({ action: "logout", token });
    } catch {
      /* Si falla, el token vence solo en el servidor */
    }
  }
}

/* Administrador: productos */
const productDialog = $("#product-dialog");
const productForm = $("#product-form");
const productStatus = $("#product-status");
const productSubmit = $("#product-submit");

function fillTypeOptions() {
  $("#product-type").innerHTML = Object.entries(TYPE_LABELS)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
}

function openProductDialog(id = null) {
  const product = id === null ? null : findProduct(id);
  if (id !== null && !product) return;

  state.editingId = id;
  productForm.reset();
  productStatus.textContent = "";
  $("#product-title").textContent = product ? "Editar producto" : "Agregar producto";

  if (product) {
    for (const [key, value] of Object.entries(product)) {
      if (productForm.elements[key]) productForm.elements[key].value = value;
    }
  }
  productDialog.showModal();
}

function readProductForm(formData) {
  const text = (field) => String(formData.get(field) || "").trim();

  return {
    name: text("name"),
    category: text("category"),
    detail: text("detail"),
    price: Math.round(Number(formData.get("price"))),
    type: text("type"),
    color: text("color"),
    bg: text("bg")
  };
}

/* Envia el catalogo completo al script y adopta la version que devuelve */
async function persistProducts(nextProducts) {
  const result = await apiPost({
    action: "saveProducts",
    token: state.admin.token,
    products: nextProducts
  });

  state.products = result.products;
  refreshCatalog();
}

function reportAdminError(error, statusElement) {
  if (error.code === "auth") {
    clearSession();
    productDialog.close();
    showToast("La sesión venció. Ingresá de nuevo.");
  } else if (statusElement) {
    statusElement.textContent = describeError(error);
  } else {
    showToast(describeError(error));
  }
}

async function handleProductSubmit(event) {
  event.preventDefault();
  if (!state.admin) return;

  const product = readProductForm(new FormData(productForm));
  const isEdit = state.editingId !== null;
  const nextId = state.products.reduce((max, item) => Math.max(max, item.id), 0) + 1;

  const nextProducts = isEdit
    ? state.products.map((item) => (item.id === state.editingId ? { ...product, id: item.id } : item))
    : [...state.products, { ...product, id: nextId }];

  setBusy(productSubmit, true, "Guardando...");
  productStatus.textContent = "";

  try {
    await persistProducts(nextProducts);
    productDialog.close();
    showToast(isEdit ? "Producto actualizado" : "Producto agregado");
  } catch (error) {
    reportAdminError(error, productStatus);
  } finally {
    setBusy(productSubmit, false);
  }
}

async function deleteProduct(id) {
  const product = findProduct(id);
  if (!product || !window.confirm(`¿Eliminar "${product.name}" del catálogo?`)) return;

  try {
    await persistProducts(state.products.filter((item) => item.id !== id));
    showToast("Producto eliminado");
  } catch (error) {
    reportAdminError(error);
  }
}

/* Carga el catalogo guardado en Google. Si no hay conexion, queda el inicial. */
async function loadRemoteProducts() {
  try {
    const result = await apiGet("products");
    if (Array.isArray(result.products) && result.products.length > 0) {
      state.products = result.products;
      refreshCatalog();
    }
  } catch {
    /* Sin conexion o sin configurar: se usa DEFAULT_PRODUCTS */
  }
}

/* Eventos: un solo click delegado, cada boton declara su accion en data-action */
const ACTIONS = {
  category: (el) => { state.category = el.dataset.category; renderChips(); renderGrid(); },
  add:      (el) => { changeQuantity(Number(el.dataset.id), 1); showToast("Agregado al carrito"); },
  increase: (el) => changeQuantity(Number(el.dataset.id), 1),
  decrease: (el) => changeQuantity(Number(el.dataset.id), -1),
  remove:   (el) => removeFromCart(Number(el.dataset.id)),
  edit:     (el) => openProductDialog(Number(el.dataset.id)),
  delete:   (el) => deleteProduct(Number(el.dataset.id))
};

document.addEventListener("click", (event) => {
  const element = event.target.closest("[data-action]");
  if (element && ACTIONS[element.dataset.action]) ACTIONS[element.dataset.action](element);
});

$("#search").addEventListener("input", (event) => { state.query = event.target.value; renderGrid(); });
$("#sort").addEventListener("change", (event) => { state.sort = event.target.value; renderGrid(); });

$("#open-cart").addEventListener("click", () => setCartOpen(true));
$("#close-cart").addEventListener("click", () => setCartOpen(false));
$("#scrim").addEventListener("click", () => setCartOpen(false));
$("#pay").addEventListener("click", openCheckout);
$("#cancel-checkout").addEventListener("click", () => checkoutDialog.close());
checkoutForm.addEventListener("submit", handleSubmit);

$("#login-button").addEventListener("click", openLogin);
$("#logout-button").addEventListener("click", logout);
$("#cancel-login").addEventListener("click", () => loginDialog.close());
loginDialog.addEventListener("close", () => loginForm.reset()); // No deja la contraseña en el formulario
loginForm.addEventListener("submit", handleLogin);

$("#add-product").addEventListener("click", () => openProductDialog());
$("#cancel-product").addEventListener("click", () => productDialog.close());
productForm.addEventListener("submit", handleProductSubmit);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#cart").classList.contains("is-open")) setCartOpen(false);
});

/* Inicio */
$("#app-version").textContent = APP_VERSION;
$("#hero-art").innerHTML = plantSvg("hojas", "#2F6B45");
fillTypeOptions();
renderSession();
refreshCatalog();
loadRemoteProducts();
