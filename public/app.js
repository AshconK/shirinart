const state = {
  artworks: [],
  cart: loadCart(),   // array of artwork ids
};

/* ---- cart persistence (survives refresh) ---- */
function loadCart() {
  try { return JSON.parse(localStorage.getItem("shirinart_cart")) || []; }
  catch { return []; }
}
function saveCart() {
  localStorage.setItem("shirinart_cart", JSON.stringify(state.cart));
}

function money(cents) { return "$" + (cents / 100).toFixed(2); }

// Home nav: frost the bar once the user scrolls past the hero
const heroNav = document.querySelector(".nav--hero");
if (heroNav) {
  const onScroll = () => heroNav.classList.toggle("is-scrolled", window.scrollY > 80);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ---- load + render the gallery ---- */
async function loadGallery() {
  const grid = document.getElementById("grid");
  if (!grid) return;  // some pages won't have a grid

  const limit = parseInt(grid.dataset.limit) || 0;  // 0 = show all

  const res = await fetch("/api/artworks");
  state.artworks = await res.json();
  pruneCart();

  // home page shows only the first N available; gallery shows everything
  let toShow = state.artworks;
  if (limit > 0) {
    toShow = state.artworks.filter(a => a.status === "available").slice(0, limit);
  }

  grid.innerHTML = "";
  for (const art of toShow) grid.appendChild(renderCard(art));
  refreshCartUI();
}

function renderCard(art) {
  const sold = art.status !== "available";
  const inCart = state.cart.includes(art.id);
  const meta = [art.medium, art.dimensions, art.year].filter(Boolean).join(" · ");

  const card = document.createElement("article");
  card.className = "card" + (sold ? " card--sold" : "");
  card.innerHTML = `
    <div class="card__frame">
      ${sold ? `<span class="card__badge">Sold</span>` : ""}
      <img src="${art.image_path}" alt="${art.title}" loading="lazy" />
    </div>
    <div class="card__body">
      <h3 class="card__title">${art.title}</h3>
      <p class="card__meta">${meta}</p>
      <div class="card__row">
        <span class="card__price ${sold ? "card__price--sold" : ""}">${money(art.price_cents)}</span>
        ${sold
          ? `<span class="card__meta">Sold</span>`
          : `<button class="btn ${inCart ? "btn--ghost" : "btn--solid"}" data-add="${art.id}">
               ${inCart ? "In cart" : "Add to cart"}
             </button>`}
      </div>
    </div>
  `;
  const btn = card.querySelector("[data-add]");
  if (btn) btn.addEventListener("click", () => toggleCart(art.id));
  return card;
}

/* ---- cart actions ---- */
function toggleCart(id) {
  const i = state.cart.indexOf(id);
  if (i === -1) state.cart.push(id); else state.cart.splice(i, 1);
  saveCart();
  loadGallery();
  if (state.cart.includes(id)) openDrawer();
}
function removeFromCart(id) {
  state.cart = state.cart.filter((x) => x !== id);
  saveCart();
  loadGallery();
}
function pruneCart() {
  const buyable = new Set(state.artworks.filter((a) => a.status === "available").map((a) => a.id));
  state.cart = state.cart.filter((id) => buyable.has(id));
  saveCart();
}
function cartItems() {
  return state.cart.map((id) => state.artworks.find((a) => a.id === id)).filter(Boolean);
}

/* ---- cart UI ---- */
function refreshCartUI() {
  const items = cartItems();
  const countEl = document.getElementById("cartCount");
  countEl.textContent = items.length;
  countEl.hidden = items.length === 0;

  const total = items.reduce((s, a) => s + a.price_cents, 0);
  document.getElementById("cartTotal").textContent = money(total);
  document.getElementById("checkoutBtn").disabled = items.length === 0;

  const body = document.getElementById("drawerBody");
  if (items.length === 0) {
    body.innerHTML = `<p class="drawer__empty">Your cart is empty.<br/>The gallery is waiting.</p>`;
    return;
  }
  body.innerHTML = "";
  for (const a of items) {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <img class="cart-item__thumb" src="${a.image_path}" alt="" />
      <div class="cart-item__info">
        <p class="cart-item__title">${a.title}</p>
        <p class="cart-item__price">${money(a.price_cents)}</p>
        <button class="cart-item__remove" data-remove="${a.id}">Remove</button>
      </div>
    `;
    row.querySelector("[data-remove]").addEventListener("click", () => removeFromCart(a.id));
    body.appendChild(row);
  }
}

/* ---- drawer open/close ---- */
const drawer = document.getElementById("drawer");
const overlay = document.getElementById("drawerOverlay");
function openDrawer() { drawer.classList.add("is-open"); drawer.setAttribute("aria-hidden", "false"); overlay.hidden = false; }
function closeDrawer() { drawer.classList.remove("is-open"); drawer.setAttribute("aria-hidden", "true"); overlay.hidden = true; }
document.getElementById("cartToggle").addEventListener("click", openDrawer);
document.getElementById("drawerClose").addEventListener("click", closeDrawer);
overlay.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

loadGallery();