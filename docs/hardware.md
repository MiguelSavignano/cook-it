# Cook-It physical build — reference dimensions

Reference sheet for whoever models the 3D-printed enclosure ("Gorro" concept,
see the character-concepts artifact). Not a CAD file — the real numbers to
plug into Fusion360/Tinkercad/FreeCAD, sourced from official datasheets, plus
the exact display picked for the BMO-style glowing-eyes face effect.

## Raspberry Pi 5 board

Source: [official mechanical drawing (PDF)](https://datasheets.raspberrypi.com/rpi5/raspberry-pi-5-mechanical-drawing.pdf) — also saved locally in this session's tool output if you want it offline.

- **Board: 85 × 58 mm.**
- 4× mounting holes, **Ø2.7 mm** (clearance for M2.5 screws / heat-set inserts), inset close to the corners.
- The PDF is drawn at **scale 1:1 on A4** — print it at 100% (no "fit to page") and you get a true-size paper template. Lay the real board on it to confirm before committing to a 3D print; this is far more reliable than me re-transcribing every sub-millimeter hole coordinate from a flattened PDF text dump, where the exact per-hole X/Y is easy to mis-read.
- Tallest components to clear inside the case: the GPIO header pins (top edge), the USB-C power port and 2× USB-A + Ethernet stack (right edge, ~16 mm tall as a block), and the camera/display FPC connectors (left edge, low profile). Leave headroom above the board for airflow — Pi 5 wants **active cooling** under sustained load (see `docs/feasibility.md` — this matters more once it's LLM-loaded, not idle).

## Display: 2.42" SSD1309 (blue OLED)

Chosen over color OLED (SSD1351) because the reference face (`images/latest/`) only
needs one glow color (cyan/blue) — monochrome blue OLED matches it natively,
is bigger, and is cheaper than color OLED at this size. True-black pixels
(unlike LCD/TFT) are what make the eyes look like they're floating in the
printed bezel instead of sitting on a lit rectangle.

- **Active (glowing) area: 55.01 × 27.49 mm**, 128×64 px. This is the number that matters for sizing the "eyes" and cutting the bezel window.
- Full module/PCB footprint runs a bit larger than the active area (varies slightly by seller — typically clears to roughly 65-70 mm × 40 mm including the driver chip and pin header edge). Confirm against the exact listing before finalizing the internal mounting boss positions.
- Interface: SPI or I2C (7-pin header, both wired out on most of these boards) — same protocol as the tiny test OLED, so the `luma.oled` Python prototyping carries over directly, just swap the driver from `ssd1306` to `ssd1309`.
- ~$16-26, e.g. [buydisplay.com](https://www.buydisplay.com/blue-2-4-inch-graphic-oled-display-128x64-serial-spi-i2c-ssd1309), also on eBay/Amazon under "2.42 inch SSD1309 OLED blue".

## Suggested layout (Gorro concept)

Sizing the face window proportionally to the Pi's own footprint, so the case
doesn't dwarf the board it's hiding:

- Pi 5 (85×58mm) sits flat in the base/band section of the "Gorro" body.
- The puff (upper body) needs to be wide enough to seat the OLED's ~65-70mm module
  behind a face window sized close to the 55×27.5mm active area (a few mm of
  bezel overlap on each edge to hide the PCB edge/header) — so the puff's
  front face wants to be **at least ~90mm wide** to give the window breathing
  room inside the printed bezel, comfortably wider than the Pi board itself.
- That puts the whole enclosure in a similar ballpark to the reference
  image's proportions: face window taking up roughly half the front panel's
  width, plenty of headroom above/below for the puff silhouette and the band.

## Still needed before finalizing

- Exact OLED module PCB outline + mounting hole positions from the specific listing you buy (varies by seller, see above).
- Mic + speaker physical sizes, once picked (see the earlier price list in this conversation).
- Whether to mount the Pi via its own 4 holes directly to the base, or float it on standoffs with the OLED module mounted separately to the front bezel (recommended — lets the face plate be removable independently of the board for wiring/debugging).
