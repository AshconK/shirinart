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

/* ---- lightbox ---- */
let lightboxArt = null;

function buildLightbox() {
  const el = document.createElement("div");
  el.className = "lightbox"; el.id = "lightbox"; el.hidden = true;
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `
    <div class="lightbox__overlay" id="lbOverlay"></div>
    <div class="lightbox__panel">
      <button class="lightbox__close" id="lbClose" aria-label="Close">&times;</button>
      <div class="lightbox__image-wrap"><img id="lbImg" src="" alt="" /></div>
      <div class="lightbox__info">
        <p class="lightbox__label">Original · One of a kind</p>
        <h2 class="lightbox__title" id="lbTitle"></h2>
        <p class="lightbox__meta" id="lbMeta"></p>
        <p class="lightbox__desc" id="lbDesc"></p>
        <p class="lightbox__price" id="lbPrice"></p>
        <div class="lightbox__actions"><button class="btn btn--solid btn--block" id="lbCart"></button></div>
      </div>
    </div>`;
  document.body.appendChild(el);

  document.getElementById("lbClose").addEventListener("click", closeLightbox);
  document.getElementById("lbOverlay").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLightbox(); });
  document.getElementById("lbCart").addEventListener("click", () => {
    if (lightboxArt) toggleCart(lightboxArt.id);
  });
}

function openLightbox(art) {
  lightboxArt = art;
  const sold = art.status !== "available";
  const inCart = state.cart.includes(art.id);
  const meta = [art.medium, art.dimensions, art.year].filter(Boolean).join(" · ");
  document.getElementById("lbImg").src = art.image_path;
  document.getElementById("lbImg").alt = art.title;
  document.getElementById("lbTitle").textContent = art.title;
  document.getElementById("lbMeta").textContent = meta;
  document.getElementById("lbDesc").textContent = art.description || "";
  document.getElementById("lbPrice").textContent = sold ? "Sold" : money(art.price_cents);
  const cartBtn = document.getElementById("lbCart");
  if (sold) {
    cartBtn.hidden = true;
  } else {
    cartBtn.hidden = false;
    cartBtn.textContent = inCart ? "Remove from cart" : "Add to cart";
    cartBtn.className = "btn btn--block " + (inCart ? "btn--ghost" : "btn--solid");
  }
  const lb = document.getElementById("lightbox");
  lb.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  if (lb) { lb.hidden = true; document.body.style.overflow = ""; }
  lightboxArt = null;
}

function refreshLightbox() {
  if (!lightboxArt) return;
  const updated = state.artworks.find(a => a.id === lightboxArt.id);
  if (updated) openLightbox(updated);
}

// Home nav: frost the bar once the user scrolls past the hero
const heroNav = document.querySelector(".nav--hero");
if (heroNav) {
  const onScroll = () => heroNav.classList.toggle("is-scrolled", window.scrollY > 80);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ---- reveal elements as they scroll into view ---- */
function setupReveals() {
  const targets = document.querySelectorAll(".card, .section-head");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((t) => t.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    });
  }, { threshold: 0.15 });
  targets.forEach((t) => io.observe(t));
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
  setupReveals();
  window.dispatchEvent(new Event("shirinart:rendered"));
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

  card.querySelector(".card__frame").style.cursor = "pointer";
  card.querySelector(".card__frame").addEventListener("click", () => openLightbox(art));
  return card;
}

/* ---- cart actions ---- */
function toggleCart(id) {
  const i = state.cart.indexOf(id);
  if (i === -1) state.cart.push(id); else state.cart.splice(i, 1);
  saveCart();
  loadGallery();
  refreshLightbox();
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

/* ---- custom trailing cursor — desktop pointers only ---- */
(function () {
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!fine) return;  // skip on touch devices

  const cursor = document.getElementById("cursor");
  if (!cursor) return;

  let mouseX = 0, mouseY = 0;   // where the mouse actually is
  let ringX = 0, ringY = 0;     // where the ring is (chases the mouse)

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX; mouseY = e.clientY;
    cursor.classList.add("is-active");
  });
  document.addEventListener("mouseleave", () => cursor.classList.remove("is-active"));

  // the lag: ring eases toward the mouse each frame instead of snapping
  function animate() {
    ringX += (mouseX - ringX) * 0.18;
    ringY += (mouseY - ringY) * 0.18;
    cursor.style.left = ringX + "px";
    cursor.style.top = ringY + "px";
    requestAnimationFrame(animate);
  }
  animate();

  // grow over interactive elements
  function bindHovers() {
    document.querySelectorAll("a, button, .card__frame").forEach((el) => {
      el.addEventListener("mouseenter", () => cursor.classList.add("is-hover"));
      el.addEventListener("mouseleave", () => cursor.classList.remove("is-hover"));
    });
  }
  bindHovers();
  window.addEventListener("shirinart:rendered", bindHovers); // re-bind after cards load
})();

/* ---- checkout ---- */
const checkoutBtn = document.getElementById("checkoutBtn");
if (checkoutBtn) {
  checkoutBtn.addEventListener("click", async () => {
    const note = document.getElementById("drawerNote");
    checkoutBtn.disabled = true;
    note.textContent = "Processing…";
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: state.cart }),
      });
      const data = await res.json();
      if (!res.ok) {
        note.textContent = data.error || "Something went wrong.";
        checkoutBtn.disabled = false;
        return;
      }
      window.location.href = data.url;
    } catch {
      note.textContent = "Connection error — please try again.";
      checkoutBtn.disabled = false;
    }
  });
}

/* ---- start ---- */
buildLightbox();
loadGallery();