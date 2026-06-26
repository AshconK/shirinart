require("dotenv").config();
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");

const db = new Database("shirinart.db");

const multer = require("multer");
const path = require("path");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Store uploads in memory — we stream directly to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG, or WebP images allowed."), ok);
  },
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: "shirinart", resource_type: "image" },
      (err, result) => { if (err) reject(err); else resolve(result); }
    ).end(buffer);
  });
}

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many attempts — try again in 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

// HTTP Basic Auth gate for admin routes
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString();
    const [, password] = decoded.split(":");
    if (password === process.env.ADMIN_PASSWORD) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="ShirinArt Admin"');
  res.status(401).send("Authentication required.");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS artworks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    medium      TEXT NOT NULL DEFAULT '',
    dimensions  TEXT NOT NULL DEFAULT '',
    year        INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL,
    image_path    TEXT NOT NULL DEFAULT '',
    cloudinary_id TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'available',
    category      TEXT NOT NULL DEFAULT 'oil-painting',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                TEXT PRIMARY KEY,
    stripe_session_id TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    buyer_email       TEXT,
    shipping_address  TEXT,
    total_cents       INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Safe migrations for existing databases
try { db.exec("ALTER TABLE artworks ADD COLUMN category TEXT NOT NULL DEFAULT 'oil-painting'"); } catch {}
try { db.exec("ALTER TABLE artworks ADD COLUMN cloudinary_id TEXT NOT NULL DEFAULT ''"); } catch {}

// Auto-seed demo artworks on first startup (empty database)
const isEmpty = db.prepare("SELECT COUNT(*) as n FROM artworks").get().n === 0;
if (isEmpty) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO artworks (id, title, description, medium, dimensions, year, price_cents, image_path, status, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seed = db.transaction(() => {
    insert.run("borgo-al-tramonto",  "Borgo al Tramonto",    "The last light on the rooftops of a hill town.",             "Oil on canvas", "60 × 80 cm", 2025, 85000,  "https://picsum.photos/id/1015/800/1000", "available",  "oil-painting");
    insert.run("finestra-azzurra",   "La Finestra Azzurra",  "A blue shutter left ajar on a summer afternoon.",            "Oil on linen",  "40 × 50 cm", 2024, 62000,  "https://picsum.photos/id/1025/800/1000", "available",  "oil-painting");
    insert.run("vicolo-stretto",     "Vicolo Stretto",       "A narrow alley climbing toward the church bells.",           "Oil on canvas", "50 × 70 cm", 2025, 74000,  "https://picsum.photos/id/1039/800/1000", "available",  "oil-painting");
    insert.run("panni-al-sole",      "Panni al Sole",        "Laundry strung between two stone walls.",                    "Oil on board",  "30 × 40 cm", 2024, 48000,  "https://picsum.photos/id/1043/800/1000", "sold",       "oil-painting");
    insert.run("piazza-deserta",     "Piazza Deserta",       "The empty square in the hour of the siesta.",                "Oil on canvas", "70 × 90 cm", 2023, 120000, "https://picsum.photos/id/1052/800/1000", "available",  "oil-painting");
    insert.run("uliveto-sera",       "Uliveto di Sera",      "An olive grove silvering in the evening wind.",              "Oil on linen",  "55 × 75 cm", 2025, 98000,  "https://picsum.photos/id/1067/800/1000", "sold",       "oil-painting");
  });
  seed();
  console.log("Database was empty — demo artworks seeded.");
}

const app = express();

// Webhook must come BEFORE express.json(), because Stripe's signature
// check needs the raw, unparsed request body.
app.post("/api/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const ids = (session.metadata.artwork_ids || "").split(",").filter(Boolean);

    const recordSale = db.transaction(() => {
      const markSold = db.prepare(
        "UPDATE artworks SET status = 'sold' WHERE id = ? AND status = 'available'"
      );
      for (const id of ids) {
        markSold.run(id);
      }

      db.prepare(
        `INSERT INTO orders (id, stripe_session_id, status, buyer_email, shipping_address, total_cents)
         VALUES (?, ?, 'paid', ?, ?, ?)`
      ).run(
        session.id,
        session.id,
        session.customer_details?.email || "",
        JSON.stringify(session.customer_details?.address || {}),
        session.amount_total
      );
    });

    try {
      recordSale();
      console.log(`Sale recorded: ${ids.join(", ")}`);
    } catch (err) {
      console.error("Failed to record sale:", err.message);
    }
  }

  res.json({ received: true });
});

// JSON parsing for all the OTHER routes — must come after the webhook.
app.use(express.json());

// Security headers (CSP left off until inline scripts in admin are audited)
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   ADMIN
   ============================================================ */

// Admin studio page (password-protected)
app.get("/admin", adminLimiter, requireAdmin, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Studio — ShirinArt</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root { --ink:#161618; --soft:#565660; --line:rgba(20,20,26,0.12); --accent:#2233CC; --bg:#F4F4F2; --card:#fff; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:"Work Sans",sans-serif; }
    .topbar { display:flex; align-items:center; justify-content:space-between; padding:1.2rem 2rem; border-bottom:1px solid var(--line); background:var(--card); }
    .topbar h1 { font-family:"Cormorant Garamond",serif; font-weight:600; font-size:1.6rem; margin:0; }
    .topbar a { color:var(--soft); text-decoration:none; font-size:0.9rem; }
    .wrap { max-width:1000px; margin:2.5rem auto; padding:0 1.5rem; display:grid; grid-template-columns:380px 1fr; gap:2.5rem; align-items:start; }
    @media (max-width:820px){ .wrap{ grid-template-columns:1fr; } }
    .panel { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:1.6rem; }
    .panel h2 { font-family:"Cormorant Garamond",serif; font-weight:600; font-size:1.5rem; margin:0 0 1.2rem; }
    label { display:block; font-size:0.82rem; font-weight:600; color:var(--soft); margin:0 0 0.35rem; }
    input, textarea { width:100%; font-family:inherit; font-size:0.95rem; padding:0.65rem 0.8rem; border:1.5px solid var(--line); border-radius:10px; margin-bottom:1rem; background:#fff; }
    input:focus, textarea:focus { outline:none; border-color:var(--accent); }
    .row { display:flex; gap:0.8rem; }
    .row > div { flex:1; }
    button { font-family:inherit; font-weight:600; cursor:pointer; border:none; border-radius:999px; }
    .btn-primary { background:var(--accent); color:#fff; padding:0.75rem 1.4rem; width:100%; font-size:0.95rem; }
    .btn-primary:hover { background:#18227F; }
    .list-item { display:flex; gap:1rem; align-items:center; padding:0.9rem 0; border-bottom:1px solid var(--line); }
    .list-item img { width:54px; height:68px; object-fit:cover; border-radius:30px 30px 4px 4px; border:1px solid var(--line); }
    .list-item__info { flex:1; min-width:0; }
    .list-item__title { font-family:"Cormorant Garamond",serif; font-size:1.2rem; }
    .list-item__meta { font-size:0.82rem; color:var(--soft); }
    .pill { font-size:0.72rem; padding:0.15rem 0.6rem; border-radius:999px; font-weight:600; }
    .pill--available { background:rgba(34,51,204,0.1); color:var(--accent); }
    .pill--sold { background:rgba(20,20,26,0.08); color:var(--soft); }
    .actions { display:flex; gap:0.5rem; }
    .mini { font-size:0.8rem; padding:0.4rem 0.8rem; border:1px solid var(--line); background:#fff; color:var(--soft); }
    .mini:hover { border-color:var(--accent); color:var(--accent); }
    .mini--danger:hover { border-color:#c0392b; color:#c0392b; }
    .note { font-size:0.85rem; color:var(--accent); min-height:1.2em; margin-top:0.5rem; }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>Shirin's Studio</h1>
    <a href="/" target="_blank">View gallery ↗</a>
  </div>

  <div class="wrap">
    <div class="panel">
      <h2>Add a painting</h2>
      <form id="addForm" enctype="multipart/form-data">
        <label>Title</label>
        <input name="title" required />
        <label>Description</label>
        <textarea name="description" rows="2"></textarea>
        <div class="row">
          <div><label>Medium</label><input name="medium" placeholder="Oil on canvas" /></div>
          <div><label>Year</label><input name="year" type="number" placeholder="2025" /></div>
        </div>
        <div class="row">
          <div><label>Dimensions</label><input name="dimensions" placeholder="60 x 80 cm" /></div>
          <div><label>Price (USD)</label><input name="price" type="number" step="0.01" placeholder="850" required /></div>
        </div>
        <label>Category</label>
        <select name="category" style="width:100%;font-family:inherit;font-size:0.95rem;padding:0.65rem 0.8rem;border:1.5px solid var(--line);border-radius:10px;margin-bottom:1rem;background:#fff;">
          <option value="oil-painting">Oil Painting</option>
          <option value="mosaic">Mosaic</option>
          <option value="business-cards">Business Cards</option>
          <option value="logos">Logos</option>
        </select>
        <label>Image</label>
        <input name="image" type="file" accept="image/*" required />
        <button type="submit" class="btn-primary">Add to gallery</button>
        <p class="note" id="addNote"></p>
      </form>
    </div>

    <div class="panel">
      <h2>Your collection</h2>
      <div id="list">Loading…</div>
    </div>
  </div>

  <script>
    async function loadList() {
      const res = await fetch("/api/artworks");
      const arts = await res.json();
      const list = document.getElementById("list");
      if (!arts.length) { list.innerHTML = "<p style='color:#565660'>No pieces yet.</p>"; return; }
      list.innerHTML = "";
      for (const a of arts) {
        const sold = a.status === "sold";
        const row = document.createElement("div");
        row.className = "list-item";
        row.innerHTML = \`
          <img src="\${a.image_path}" alt="" />
          <div class="list-item__info">
            <div class="list-item__title">\${a.title}</div>
            <div class="list-item__meta">$\${(a.price_cents/100).toFixed(2)} ·
              <span class="pill pill--\${sold ? "sold":"available"}">\${sold ? "Sold":"Available"}</span>
            </div>
          </div>
          <div class="actions">
            <button class="mini" data-toggle="\${a.id}">\${sold ? "Mark available":"Mark sold"}</button>
            <button class="mini mini--danger" data-del="\${a.id}">Delete</button>
          </div>\`;
        row.querySelector("[data-toggle]").onclick = () => toggle(a.id);
        row.querySelector("[data-del]").onclick = () => del(a.id, a.title);
        list.appendChild(row);
      }
    }

    async function toggle(id) {
      const res = await fetch("/admin/artworks/" + id + "/status", { method: "POST", credentials: "include" });
      if (!res.ok) { alert("Action failed (" + res.status + "). Try reloading and re-entering the password."); return; }
      loadList();
    }

    async function del(id, title) {
      if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
      const res = await fetch("/admin/artworks/" + id + "/delete", { method: "POST", credentials: "include" });
      if (!res.ok) { alert("Delete failed (" + res.status + ")."); return; }
      loadList();
    }

    document.getElementById("addForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = document.getElementById("addNote");
      note.textContent = "Uploading…";
      const data = new FormData(e.target);
      const res = await fetch("/admin/artworks", { method: "POST", body: data, credentials: "include" });
      if (res.ok) { e.target.reset(); note.textContent = "Added."; loadList(); }
      else { note.textContent = "Something went wrong."; }
    });

    loadList();
  </script>
</body>
</html>`);
});

// Add an artwork
app.post("/admin/artworks", adminLimiter, requireAdmin, upload.single("image"), async (req, res) => {
  const { title, description, medium, dimensions, year, price, category } = req.body;

  if (!title || !price || !req.file) {
    return res.status(400).send("Title, price, and image are required.");
  }

  let imagePath, cloudinaryId;
  try {
    const result = await uploadToCloudinary(req.file.buffer);
    imagePath    = result.secure_url;
    cloudinaryId = result.public_id;
  } catch (err) {
    console.error("Cloudinary upload failed:", err.message);
    return res.status(500).json({ error: "Image upload failed." });
  }

  const id =
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
    "-" + Date.now().toString().slice(-5);

  db.prepare(
    `INSERT INTO artworks (id, title, description, medium, dimensions, year, price_cents, image_path, cloudinary_id, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    description || "",
    medium || "",
    dimensions || "",
    parseInt(year) || 0,
    Math.round(parseFloat(price) * 100),
    imagePath,
    cloudinaryId,
    category || "oil-painting"
  );

  res.json({ ok: true });
});

// Delete an artwork (and its Cloudinary image)
app.post("/admin/artworks/:id/delete", adminLimiter, requireAdmin, async (req, res) => {
  const art = db.prepare("SELECT cloudinary_id FROM artworks WHERE id = ?").get(req.params.id);
  if (!art) return res.status(404).json({ error: "Not found" });

  if (art.cloudinary_id) {
    try { await cloudinary.uploader.destroy(art.cloudinary_id); } catch (err) {
      console.error("Cloudinary delete failed:", err.message);
    }
  }

  db.prepare("DELETE FROM artworks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Toggle a piece between available and sold
app.post("/admin/artworks/:id/status", adminLimiter, requireAdmin, (req, res) => {
  const art = db.prepare("SELECT status FROM artworks WHERE id = ?").get(req.params.id);
  if (!art) return res.status(404).json({ error: "Not found" });

  const next = art.status === "sold" ? "available" : "sold";
  db.prepare("UPDATE artworks SET status = ? WHERE id = ?").run(next, req.params.id);
  res.json({ ok: true, status: next });
});

/* ============================================================
   PUBLIC API + PAGES
   ============================================================ */

// Checkout — server looks up real prices, guards inventory-of-1
app.post("/api/checkout", async (req, res) => {
  const ids = req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "No items in cart." });
  }

  const placeholders = ids.map(() => "?").join(",");
  const pieces = db
    .prepare(`SELECT id, title, price_cents, status, image_path FROM artworks WHERE id IN (${placeholders})`)
    .all(...ids);

  if (pieces.length !== ids.length) {
    return res.status(400).json({ error: "One or more items no longer exist." });
  }

  const unavailable = pieces.filter((p) => p.status !== "available");
  if (unavailable.length > 0) {
    return res.status(409).json({
      error: "Some pieces are no longer available.",
      sold: unavailable.map((p) => p.title),
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: pieces.map((p) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: p.price_cents,
          product_data: { name: p.title },
        },
      })),
      shipping_address_collection: { allowed_countries: ["US", "CA", "GB"] },
      success_url: `${req.protocol}://${req.get("host")}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get("host")}/cancel`,
      metadata: { artwork_ids: ids.join(",") },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: "Could not start checkout." });
  }
});

// Public list of artworks
app.get("/api/artworks", (req, res) => {
  const artworks = db
    .prepare("SELECT id, title, description, medium, dimensions, year, price_cents, image_path, status, category FROM artworks ORDER BY created_at DESC")
    .all();
  res.json(artworks);
});

// Success page — verifies payment with Stripe
function pageShell(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — ShirinArt</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Raleway:wght@300;400;500;600&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <script src="/nav.js" defer></script>
</head>
<body class="page">
  <header class="nav nav--solid">
    <a href="/" class="wordmark">SHIRIN<span class="wordmark__art">art</span></a>
    <nav class="nav__links" aria-label="Primary">
      <a href="/">Home</a>
      <a href="/gallery.html">Gallery</a>
      <a href="/about.html">About</a>
      <a href="/contact.html">Contact</a>
    </nav>
    <div class="nav__end">
      <button class="hamburger" id="hamburger" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>
  <main class="page-wrap">
    ${bodyContent}
  </main>
  <footer class="footer">
    <div class="footer__top">
      <div class="footer__brand">
        <p class="footer__mark">SHIRIN<span class="wordmark__art">art</span></p>
        <p class="footer__tagline">Original oil paintings, each made once.</p>
      </div>
      <nav class="footer__nav" aria-label="Footer links">
        <a href="/gallery.html">Gallery</a>
        <a href="/about.html">About</a>
        <a href="/contact.html">Contact</a>
      </nav>
      <div class="footer__social">
        <a href="/contact.html" class="footer__commission-link">Commission a piece →</a>
      </div>
    </div>
    <div class="footer__bottom">
      <p class="footer__fine">© <span class="footer-year"></span> ShirinArt</p>
      <p class="footer__fine">Ships to US · Canada · UK</p>
    </div>
  </footer>
</body>
</html>`;
}

app.get("/success", async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.redirect("/");

  let paid = false;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    paid = session.payment_status === "paid";
  } catch (err) {
    console.error("Success lookup failed:", err.message);
  }

  const body = paid ? `
    <section class="page-hero" style="max-width:560px;margin:0 auto;text-align:center;">
      <p class="section-head__label">Order confirmed</p>
      <h1 class="page-hero__title">Thank you.</h1>
      <p class="page-hero__sub">Your order is confirmed. Shirin will be in touch personally about shipping and delivery.</p>
      <a href="/gallery.html" class="btn btn--solid" style="margin-top:2rem;">Return to the gallery</a>
    </section>
  ` : `
    <section class="page-hero" style="max-width:560px;margin:0 auto;text-align:center;">
      <p class="section-head__label">Something went wrong</p>
      <h1 class="page-hero__title">We couldn't confirm your payment.</h1>
      <p class="page-hero__sub">Your card may not have been charged. Please <a href="/contact.html" style="color:var(--vine)">get in touch</a> and we'll sort it out.</p>
      <a href="/" class="btn btn--ghost" style="margin-top:2rem;">Return home</a>
    </section>
  `;

  res.send(pageShell(paid ? "Thank you" : "Payment issue", body));
});

app.get("/cancel", (req, res) => {
  const body = `
    <section class="page-hero" style="max-width:560px;margin:0 auto;text-align:center;">
      <p class="section-head__label">No charge made</p>
      <h1 class="page-hero__title">Order cancelled.</h1>
      <p class="page-hero__sub">No worries — your cart is still waiting whenever you're ready.</p>
      <a href="/gallery.html" class="btn btn--solid" style="margin-top:2rem;">Back to the gallery</a>
    </section>
  `;
  res.send(pageShell("Order cancelled", body));
});

app.listen(process.env.PORT || 3000, () => console.log("listening"));