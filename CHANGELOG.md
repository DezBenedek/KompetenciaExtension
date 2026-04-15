# Changelog

## v1.1.1

### Javítások

- **Autofill hibakezelés erősítése (`scripts/main.js`)**: külön kezeljük a hálózati, beállítás-betöltési, parse és kitöltési hibákat.
- **Kitöltési retry mechanizmus (`scripts/main.js`)**: sikertelen beírás esetén automatikus újrapróbálás, validációval.
- **Részletes, felhasználóbarát státuszok (`scripts/main.js`)**: a sikertelen kitöltés oka pontosabban jelenik meg.
- **Végtelen animáció-várakozás ellen védelem (`task_logic/write_to_task.js`)**: timeout került a drag-and-drop animáció figyelésébe.
- **Garantált cleanup hiba esetén (`task_logic/write_to_task.js`)**: zoom és input-blokkolás visszaállítása védett `finally` ággal.

## v1.1.0

### Javítások

- **`getUserID()` Promise-kezelés javítása (`task_logic/read_from_task.js`, `scripts/main.js`)**.
- **WebSocket kérés timeout (`scripts/main.js`)**: megszűnt a végtelen várakozás.
- **Tömb-összehasonlítás javítása (`scripts/main.js`)**: `.toString()` helyett `JSON.stringify()`.
- **Storage inicializálási versenyhelyzet csökkentése (`background_worker/background.js`)**.
- **XSS kockázat csökkentése (`scripts/task_statuses.js`)**: `innerHTML` helyett `textContent`.
