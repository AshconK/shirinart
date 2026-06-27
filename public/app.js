const state = {
  artworks: [],
  cart: loadCart(),
  category: "all",
  viewMode: "grid",
};

/* ---- cart persistence (survives refresh) ---- */
function loadCart() {
  try { return JSON.parse(localStorage.getItem("shirinart_cart")) || []; }
  catch { return []; }
}
function saveCart() {
  localStorage.setItem("shirinart_cart", JSON.stringify(state.cart));
}

function money(cents) {
  const d = cents / 100;
  return '$' + (Number.isInteger(d) ? d.toLocaleString('en-US') : d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

function parseDims(dimStr) {
  const m = dimStr && dimStr.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/i);
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : null;
}

/* ---- lightbox ---- */
let lightboxArt = null;
let currentFrame = "";

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
        <div class="lightbox__frames" id="lbFrames">
          <p class="lightbox__frames-label">Virtual frame</p>
          <div class="lightbox__frame-opts">
            <button class="frame-opt is-active" data-frame="">None</button>
            <button class="frame-opt" data-frame="natural">Wood</button>
            <button class="frame-opt" data-frame="black">Black</button>
            <button class="frame-opt" data-frame="white">White</button>
            <button class="frame-opt" data-frame="gold">Gold</button>
            <button class="frame-opt" data-frame="float">Float</button>
          </div>
        </div>
        <div class="lightbox__wallscale" id="lbWallScale" hidden>
          <p class="wallscale__label">Scale on your wall</p>
          <div class="wallscale__vis">
            <div class="wallscale__wall-col"></div>
            <div class="wallscale__painting-col" id="wallscalePainting"></div>
          </div>
          <div class="wallscale__ctrl">
            <label for="ceilingSlider">Ceiling: <strong id="ceilingVal">9</strong> ft</label>
            <input type="range" id="ceilingSlider" min="7" max="14" value="9" step="0.5" />
          </div>
          <p class="wallscale__note" id="wallscaleNote"></p>
        </div>
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
  document.getElementById("lbFrames").addEventListener("click", e => {
    const btn = e.target.closest(".frame-opt");
    if (!btn) return;
    currentFrame = btn.dataset.frame;
    document.querySelectorAll(".frame-opt").forEach(b => b.classList.toggle("is-active", b === btn));
    document.querySelector(".lightbox__image-wrap").dataset.frame = currentFrame;
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
  // Restore active frame
  const imageWrap = document.querySelector(".lightbox__image-wrap");
  imageWrap.dataset.frame = currentFrame;
  document.querySelectorAll(".frame-opt").forEach(b =>
    b.classList.toggle("is-active", b.dataset.frame === currentFrame)
  );

  // Wall scale tool
  const dims = parseDims(art.dimensions);
  const wallScaleEl = document.getElementById("lbWallScale");
  if (dims) {
    wallScaleEl.hidden = false;
    // Replace slider to clear any stale listeners from a previous painting
    const oldSlider = document.getElementById("ceilingSlider");
    const newSlider = oldSlider.cloneNode(true);
    oldSlider.replaceWith(newSlider);
    const updateScale = () => {
      const ft = parseFloat(newSlider.value);
      const pct = (dims.h / (ft * 12)) * 100;
      document.getElementById("ceilingVal").textContent = ft;
      document.getElementById("wallscalePainting").style.height = Math.min(pct, 100) + "%";
      document.getElementById("wallscaleNote").textContent =
        `This ${dims.h}″ painting fills ${Math.round(pct)}% of your ${ft}ft wall.`;
    };
    newSlider.addEventListener("input", updateScale);
    updateScale();
  } else {
    wallScaleEl.hidden = true;
  }

  const lb = document.getElementById("lightbox");
  lb.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  if (lb) {
    lb.hidden = true;
    document.body.style.overflow = "";
    const imageWrap = document.querySelector(".lightbox__image-wrap");
    if (imageWrap) imageWrap.dataset.frame = "";
  }
  lightboxArt = null;
  currentFrame = "";
  document.querySelectorAll(".frame-opt").forEach((b, i) => b.classList.toggle("is-active", i === 0));
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

// Hero parallax — background image drifts slower than the page scroll
const heroImage = document.getElementById("heroImage");
if (heroImage) {
  const heroSection = heroImage.closest(".hero");
  window.addEventListener("scroll", () => {
    const scrolled = window.scrollY;
    if (heroSection && scrolled < heroSection.offsetHeight * 1.5) {
      heroImage.style.backgroundPositionY = `calc(50% + ${scrolled * 0.28}px)`;
    }
  }, { passive: true });
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

  // home page shows only the first N available; gallery shows everything (filtered by category)
  let toShow = state.artworks;
  if (limit > 0) {
    toShow = state.artworks.filter(a => a.status === "available").slice(0, limit);
  } else if (state.category !== "all") {
    toShow = state.artworks.filter(a => a.category === state.category);
  }

  grid.innerHTML = "";
  if (toShow.length === 0) {
    const empty = document.createElement("div");
    empty.className = "grid__empty";
    empty.innerHTML = `<p class="grid__empty-text">Nothing in this category yet — more coming soon.</p>`;
    grid.appendChild(empty);
    refreshCartUI();
    return;
  }
  if (state.viewMode === "wall") {
    grid.classList.add("wall-view");
    for (const art of toShow) grid.appendChild(renderWallCard(art));
  } else {
    grid.classList.remove("wall-view");
    toShow.forEach((art, i) => {
      const card = renderCard(art);
      card.style.setProperty("--card-delay", `${Math.min(i, 7) * 65}ms`);
      grid.appendChild(card);
    });
    setupReveals();
  }
  refreshCartUI();
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
      ${!sold ? `<div class="card__hover-info">
        <p class="card__hover-title">${art.title}</p>
        <p class="card__hover-price">${money(art.price_cents)}</p>
      </div>` : ""}
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

function renderWallCard(art) {
  const dims = parseDims(art.dimensions);
  const wallH = window.innerWidth < 600 ? 180 : 300;
  const ratio = dims ? dims.w / dims.h : 3 / 4;
  const cardW = Math.round(wallH * ratio);
  const sold = art.status !== "available";
  const inCart = state.cart.includes(art.id);

  const el = document.createElement("figure");
  el.className = "wall-card" + (sold ? " wall-card--sold" : "");
  el.style.width = cardW + "px";
  el.style.height = wallH + "px";
  el.innerHTML = `
    <img src="${art.image_path}" alt="${art.title}" loading="lazy" />
    ${sold ? `<div class="wall-card__sold">Sold</div>` : ""}
    <figcaption class="wall-card__label">
      <span class="wall-card__title">${art.title}</span>
      <span class="wall-card__price">${sold ? "Sold" : money(art.price_cents)}</span>
      ${!sold ? `<button class="wall-card__cart" data-add="${art.id}">${inCart ? "In cart" : "Add to cart"}</button>` : ""}
    </figcaption>`;
  el.addEventListener("click", () => openLightbox(art));
  const btn = el.querySelector("[data-add]");
  if (btn) btn.addEventListener("click", e => { e.stopPropagation(); toggleCart(art.id); });
  return el;
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

/* ---- category filter tabs ---- */
document.querySelectorAll(".filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.category = tab.dataset.cat;
    loadGallery();
  });
});

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

/* ---- view mode toggle (gallery page only) ---- */
document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.viewMode = btn.dataset.view;
    document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("is-active", b === btn));
    loadGallery();
  });
});

/* ---- start ---- */
buildLightbox();
loadGallery();