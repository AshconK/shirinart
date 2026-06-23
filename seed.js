/* Dummy Italian-village pieces so the gallery has something to show.
   Run with the server stopped:  node seed.js
   Remove later once Shirin adds real work through /admin. */

const Database = require("better-sqlite3");
const db = new Database("shirinart.db");

const pieces = [
  ["borgo-al-tramonto", "Borgo al Tramonto", "The last light on the rooftops of a hill town.", "Oil on canvas", "60 x 80 cm", 2025, 85000, "available", 1015],
  ["finestra-azzurra", "La Finestra Azzurra", "A blue shutter left ajar on a summer afternoon.", "Oil on linen", "40 x 50 cm", 2024, 62000, "available", 1025],
  ["vicolo-stretto", "Vicolo Stretto", "A narrow alley climbing toward the church bells.", "Oil on canvas", "50 x 70 cm", 2025, 74000, "available", 1039],
  ["panni-al-sole", "Panni al Sole", "Laundry strung between two stone walls.", "Oil on board", "30 x 40 cm", 2024, 48000, "sold", 1043],
  ["piazza-deserta", "Piazza Deserta", "The empty square in the hour of the siesta.", "Oil on canvas", "70 x 90 cm", 2023, 120000, "available", 1052],
  ["uliveto-sera", "Uliveto di Sera", "An olive grove silvering in the evening wind.", "Oil on linen", "55 x 75 cm", 2025, 98000, "sold", 1067],
];

// keep only the seeded pieces — remove any other rows (old test data)
const keepIds = pieces.map((p) => p[0]);
const placeholders = keepIds.map(() => "?").join(",");
db.prepare(`DELETE FROM artworks WHERE id NOT IN (${placeholders})`).run(...keepIds);

const insert = db.prepare(`
  INSERT OR REPLACE INTO artworks
    (id, title, description, medium, dimensions, year, price_cents, image_path, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const [id, title, desc, medium, dim, year, price, status, imgId] of pieces) {
  insert.run(id, title, desc, medium, dim, year, price,
    `https://picsum.photos/id/${imgId}/800/1000`, status);
}

console.log(`Seeded ${pieces.length} dummy artworks.`);