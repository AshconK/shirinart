const Database = require("better-sqlite3");
const db = new Database("shirinart.db");

db.prepare("UPDATE artworks SET status='available' WHERE id='borgo-al-tramonto'").run();
db.prepare("DELETE FROM orders").run();

console.log("reset done");