# Accessory Editor — Selfie Social Society

3D editor for NPC accessories: in-hand, on-head and on-back starter assets.

## What it does
- Pick any of the 13 NPCs (live from the shared manifest) and preview them in 3D
- Equip starter accessories: 14 in-hand (gavel, flag, coin, balloon, yarn, scroll,
  gold bar, flower, envelope, rod, camera, die, hammer, cane), 5 hats (tall top hat,
  mail cap, bucket hat, straw hat, tour cap), 1 back cape
- Edit any accessory part-by-part: position, rotation, scale, color, roughness
- Add primitives, duplicate accessories, create new ones from scratch
- Export everything as JSON (defs + per-NPC loadout)

## Assets
`accessory-library.js` is the starter asset pack — plain JSON defs plus a
`buildAccessory(def, THREE)` helper any tool can import.

## Run it
Open `index.html` — it's fully static. Character art loads live from the game repo.
