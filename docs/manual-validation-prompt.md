# Manual UI validation — prompt for a testing agent

Copy everything below the line into the other agent.

---

You are manually testing a web app: a **unit-aware scientific calculator**, laid out like an expression list (Desmos-style) with typeset math input. Use it in a real browser the way a person would — click, type on the keyboard, use menus — and report what works, what doesn't, and what's confusing. **Do not edit any code.** Your job is to find problems, not fix them.

## Setup

1. In the project folder (`D:\Claude\Unit Scientific Calculator`), run `npm install` if `node_modules` is missing, then `npm run dev`. The app is at **http://localhost:5173**.
2. Use a **fresh browser profile or a private window**, so saved worksheets and settings from earlier testing don't affect you. The app saves to localStorage; you can also start clean from ☰ (top left) → New worksheet.
3. Type with real key presses. Automation that inserts text without key events can skip the editor's behaviour (for example `*` turning into `·`, `/` making a fraction). If your tool only "pastes" text, say so in your report.
4. Read `DESIGN.md` only if you need to check intended behaviour; it is the spec. The decision log at the top (D1–D28) summarises every rule.

## How the app is meant to work (short version)

- Each row is an expression. Typing `X = 6N` defines X as 6 newtons. Units after a number become teal **unit chips**; autocomplete appears while typing a unit or name (**Tab** inserts the highlighted suggestion, ↑/↓ to choose, Esc dismisses).
- Each result appears **on its own line below the input**, right-aligned in a tinted box, e.g. `= 300 MPa ▾`. The **unit chip in the result is a dropdown**: picking another unit only changes the display (the number always matches the unit shown). A dot on the chip means a unit was chosen by hand; "Reset to automatic" undoes it.
- A defined variable beats a unit of the same letter (`F = 3 N`, then `2F` is 6 N, not 2 farads).
- Folders group rows. Inside a folder, a definition row has a **◎ global / ▣ folder** pill: folder-scoped names only apply inside that folder.
- The **ƒ(x) Functions** button opens a keypad drawer at the bottom (tabs: Trig, Hyperbolic, Powers & logs, Rounding, Special, Statistics, Calculus, Greek). Keys insert at the caret of the row being edited.
- ⚙ (top right) has significant figures, notation, the scientific-notation threshold, exact fractions, **unit packages** (Mechanical, Electrical, Physics, Chemistry, Cooking, UK imperial) and theme. These are saved per worksheet.

## What to test

Work through every section. For each check, note **Pass / Fail / Unclear**, and for anything not a clean pass, what you did, what you expected and what you saw (a screenshot helps). Expected values assume default settings (10 significant figures, Auto notation, RAD mode) unless a step says otherwise.

### 1. Basic entry and results
- Type `2+3` → `= 5`. Type `2/5` using the `/` key (it becomes a stacked fraction) → `= 0.4` (or `2/5`, both fine).
- `1/3` → shows an exact fraction `1/3`; the **a/b** button on the row toggles decimal/fraction.
- `X = 6N` → the result box shows `= 6 N`. Then add a row `X/2mm^2` → `= 3 N/mm²`.
- Open that result's unit dropdown, choose **MPa** → `3 MPa`; choose **psi** → `435.1132132 psi`. Type a unit into the dropdown's search box (e.g. `kip/in^2`) → it previews and applies. Type a wrong-dimension unit (e.g. `m`) → it refuses with a clear message.
- `3mm * 2m` (type `*`) → the `*` shows as `·`; result `6000 mm²`.
- `2m + 30mm` → `2.03 m`. `2m + 3s` → a readable error about adding length and time.
- `20°C + 5Δ°C` → `25 °C`. `20°C + 20°C` → an error (can't add two absolute temperatures).
- `sin(30°)` → `0.5`. Toggle **RAD/DEG** in the top bar and check `sin(30)` changes meaning (0.5 in DEG).
- Large and small numbers: `6.02*10^23` → scientific notation `6.02 × 10²³`. In ⚙ set "Scientific notation from" to 10⁶ and check `6430000` shows `6.43 × 10⁶`; set it back to 10¹².
- `MPa·mm²` case: `3MPa * 2mm^2` → `6 N`. `2N * 3m` stays `6 N·m`; `6N / 2mm^2` stays `3 N/mm²`.

### 2. Unit chips, autocomplete, variables
- Type `5 newton` (spelled out) or `5 N` → both mean newtons; Tab inserts a chip; Backspace right after a chip turns it back into plain letters.
- Type `lb` → autocomplete asks **lbm or lbf**.
- Define `F = 10N`, then in a new row type `F` → the **variable F** is the first suggestion, the farad is not forced on you. `2F` → `20 N`.
- Undefined name: `q + 1` → a message like "“q” isn't defined yet: add a row like q = 5".
- Duplicate: define `a = 1` and `a = 2` → both rows say defined more than once.
- Display-unit inheritance: `G = 3m`, set its unit to **yd** → the row still shows the typed `G = 3m` with `= 3.280839895 yd` below. A row using G afterwards follows sensibly.

### 3. Rows, folders, notes, tables, sliders
- **+ Add** menu: add an expression, note, folder, table. Enter in a row creates a new row below and moves the caret there; ↑/↓ move between rows; Backspace in an empty row deletes it.
- Undo/redo (top bar arrows, Ctrl+Z / Ctrl+Shift+Z) for typing, deleting rows and changing a unit.
- Drag a row by its handle (gutter, on hover) into and out of a folder. Collapse/expand a folder; "Collapse folders" in the toolbar.
- **Scroll a long worksheet**: the bar with + Add / Collapse folders / Functions must stay visible under the top bar.
- Table: header `x_1` with values 10, 20, 30, then set the column's unit (its unit button) to mm — plain numbers in an input column take that unit; a second column `y_1 = f(x_1)` with `f(x) = x^2 · 4 N/m^2` defined → 400, 1600, 3600 µN (or equivalent). Open a **column unit dropdown**: it must be fully visible on screen, not clipped or hanging off the edge (try the left column and the right column, and near the bottom of the window).
- Slider: on a plain row like `L = 1.5m`, click ⟷ → a slider appears; dragging changes L and dependent rows; min/max/step boxes work.

### 4. Folder scope
- In a folder, define `F = 3N` and switch its pill to **▣ folder**. In a second folder define `F = 5N` (also folder). `2F` inside each folder → 6 N and 10 N.
- A row **outside** both folders using `F` (e.g. `F/2`) → a yellow warning explaining F is only defined inside those folders. Switch one back to global → warning goes away.

### 5. Function toolbox
- Open **ƒ(x) Functions**. Click into a row first, then click keys: they insert at the caret and keep focus in the row. Try one key from each tab.
- With no row focused, clicking a key starts a new row.
- Special: `Γ(5)` → 24, `Γ(0.5)` → 1.772453851, `nCr(5,2)` → 10, `erf(0.5)` → 0.5204998778.
- Greek tab inserts letters; `σ = 5MPa` works as a name.
- The drawer must never hide the last rows (scroll to the bottom with each tab open, including Greek).

### 6. Calculus, Σ/Π, piecewise (use the Calculus tab, then fill the boxes; Tab moves between boxes)
- `∫₀¹ x² dx` → 0.3333333333. `∫₀^{3 m} x dx` → 4.5 m². `∫₀^∞ e^{−x} dx` → 1.
- Integral with an empty limit box → a message telling you to fill in the limit. Integral without the `dx` → a message to end it with dx.
- `x = 3`, then `d/dx x²` → 6. Without any x defined → a message explaining the derivative uses the current value of x.
- `lim x→0 sin(x)/x` → 1 **in RAD mode** (in DEG mode it is 0.01745…, by design — note whether that confuses you). `lim x→0 |x|/x` → "doesn't exist" with left/right values.
- `Σ_{x=3}^{12} x` → 75; `Π_{n=1}^{5} n` → 120. Leave the top of Σ empty → "Σ needs an end value: type it above the Σ".
- Piecewise `{x<0: −x, x}` with `x = −2` → 2, with `x = 5` → 5.
- Raise something to a power, then delete the power's contents (leaving an empty power box) → should be ignored, not an error.

### 7. Unit packages (⚙ → Unit packages)
- With all packages off: typing `2Torr` or `3kip` is not recognised as a unit (the row should say the unit is from a package that is off, with a link to turn it on); the `5 kPa` dropdown does **not** list torr or ksi but does list psi. Typing a unit into the dropdown's search box accepts any unit, package or not — that is by design.
- Turn on **Chemistry** → `2Torr` works, torr appears in suggestions. Turn on **Mechanical** → `3kip`, ksi in dropdowns.
- A row that already has a torr **chip** while Chemistry/Physics are off: it still calculates and shows an ⓘ note with a "Turn on …" link that works.
- Settings are per worksheet: make a new worksheet (☰) and check its packages start off.

### 8. Errors are understandable
Try deliberately broken input and judge whether each message tells a non-expert what to do (not LaTeX jargon): `2+`, `2)`, `x<3` outside a piecewise, `a = b = 2`, an empty fraction box, `\frac{}{2}`-style empty parts, `lim` with nothing after the arrow. Record any message that is confusing, and quote it exactly.

### 9. Persistence, files, settings
- Reload the page → the worksheet and settings come back.
- ☰ menu: create, switch between and delete worksheets.
- **Export** downloads a `.usc.json`; **Import** that file back → identical worksheet (rows, folders, units chosen, slider, packages).
- ⚙: change significant figures (e.g. 4) and notation (Scientific, Engineering) and check results update; toggle exact fractions; switch theme Light/Dark/System and check everything stays readable (results, chips, warnings, toolbox, dropdowns).

### 10. Layout
- Resize to phone width (~375 px): no sideways scrolling of the page, results still readable, toolbox usable (its tabs scroll sideways), dropdowns stay on screen, the top bar wraps cleanly.
- Keyboard only: can you reach and operate the main controls with Tab/Enter/Esc? Note anything unreachable.

## Report format

Reply with:

1. **Summary** — 3–5 lines: overall state and the most important problems.
2. **Findings table** — one row per issue: `#`, section, severity (**Blocker** / **Major** / **Minor** / **Polish**), steps to reproduce, expected, actual, screenshot/notes.
3. **Passed checks** — a compact list of what worked, so nothing is ambiguous.
4. **Could not test** — anything you couldn't do and why (tool limitations, missing permissions).
5. **Usability notes** — places that worked but felt confusing or slow, in plain words.

Be specific and literal: quote exact values and messages, give the exact keys you pressed. Don't guess at causes in the code; describe behaviour.
