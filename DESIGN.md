# Dimensional — Design Spec (v0.1)

**Dimensional** (*every number knows its units*) is a web-based, unit-aware engineering calculator, styled as an engineering notebook (§3.6). Lives at <https://dimensional.perrysahnow.com>. The UI takes the expression list from the Desmos graphing calculator (folders, named variables, functions, sliders, tables, notes) and the result-per-line feel of the Desmos scientific calculator. There is no graphing. Every quantity carries units, every value has a unit dropdown, and unit handling happens behind the scenes: **the number shown always matches the unit shown next to it.**

---

## 1. Goals and non-goals

### Goals
- Write engineering math with real units: `X = 6 N`, `A = 2 mm²`, `σ = X / A` → `3 N/mm²`.
- Results come out in the units the expression produces, simplified sensibly, and can be switched from a dropdown (`N/mm²` → `MPa`, `psi`, `N/m²`, …).
- Catch dimension errors (`5 m + 3 s`) at once, with a clear message.
- Keep exact arithmetic wherever possible (fractions, exact conversion factors).
- Run fully in the browser with no backend; autosave locally; export and import worksheets.

### Non-goals (v1)
- Graphing of any kind.
- Accounts, cloud sync, share links.
- Currency.
- User-defined units (deferred; see §13).
- An on-screen keypad (keyboard input only).
- Symbolic algebra (solving, simplifying expressions). Only numeric evaluation, exact where possible.

---

## 2. Decision log

| # | Decision | Choice |
|---|---|---|
| D1 | Deliverable | Single Markdown spec (this file) |
| D2 | Unit vs. variable disambiguation | **Unit chips via autocomplete.** Typing a unit symbol turns it into a styled chip; Backspace on a chip turns it back into plain letters (a variable) |
| D3 | Unit dropdown on an *input* value | **Display only.** The typed source (`6 N`) never changes; the line shows the converted value (`1.34885 lbf`) |
| D4 | Stack | TypeScript + React (Vite), static site |
| D5 | Default result units | **Smart simplify.** Collapse to a named unit when the composed form is messy; otherwise keep the composed form |
| D6 | Persistence | localStorage autosave + JSON file export/import |
| D7 | Input style | Typeset 2D math (Desmos-like), no keypad |
| D8 | Unit scope | Standard SI and Imperial/US engineering units, affine temperature, physical constants |
| D9 | Mixed-unit addition | Result takes the **first operand's** unit (`2 m + 30 mm` → `2.03 m`) |
| D10 | Display unit propagation | **Inherit.** If `Y` is displayed in MPa, then `Z = 2·Y` shows MPa |
| D11 | List features in v1 | User functions, sliders, tables, lists (plus folders, variables, notes) |
| D12 | Angles | Angles are units (`°`, `rad`, `grad`, `arcmin`, …); a global RAD/DEG toggle applies to *bare* numbers in trig |
| D13 | N·m vs J | Keep `N·m`, offer `J` in the dropdown (collapse only messy forms) |
| D14 | Imperial name clashes | US customary; `lb` = pound-**mass**; `lbf` for force; `gal` = US gal; `ton` = short ton; UK variants named explicitly |
| D15 | Numeric precision | **Exact where possible**: rationals kept exact, floating point only after irrational operations |
| D16 | Same-dimension product | Merge into the **first** unit: `3 mm · 2 m` → `6000 mm²` |
| D17 | Bare letter that matches a unit and is not a defined variable | **Auto-chip** it as a unit |
| D18 | Input row with a display unit chosen | The typed source **always** stays visible, with the converted value beside it: `G = 3 m` → `= 3.280839895 yd` *(revised; was "converted value only")* |
| D19 | Default significant figures | 10, trailing zeros trimmed |
| D20 | Typing `lb` | Always opens the autocomplete prompt (lbm or lbf), even after a number. If you don't pick (e.g. focus leaves the row), it falls back to lbm (D14) |
| D21 | Defined variable vs. unit symbol after a number | **The variable wins**: with `F` defined, `2F` is 2×F, not 2 farads. Chips, and runs that aren't defined variables (`6N`), still mean the unit. A run of several letters made only of defined variables (`Pa` with `P` and `a` defined) means the unit after a number |
| D22 | Where results appear | **On their own line below the input**, right-aligned and typeset like printed math, so the sheet reads like a scientific worksheet. Every row with a value gets the result box, plain typed values included (`L = 1.5 m` → `= 1.5 m`), for consistency. A row counts as a plain typed value (and can become a slider) only when it is a number (optionally ×10ⁿ) with units |
| D23 | `MPa·mm²` and similar products of named units | **Collapse to the named unit** (`N`), prefixed to keep the value. Stresses (`N/mm²`), torque (`N·m`) and `kW·h` stay as written |
| D24 | Variable scope | Global by default; a **per-row global/folder switch** limits a definition to its folder. Folder definitions win inside their folder and may shadow globals; lookups are lexical |
| D25 | Function toolbox | A **bottom keypad drawer** with tabbed groups (trig, hyperbolic, powers & logs, rounding, special, statistics) that inserts at the caret. Adds Γ, erf/erfc, inverse hyperbolics, nCr, nPr, gcd, lcm |
| D26 | Unit packages | **Base set always on; per-worksheet packages** (Mechanical, Electrical, Physics, Chemistry, Cooking, UK imperial) in ⚙ Settings. Packages overlap; chips from an off package still work and offer to turn it on |
| D27 | Solvers | **Numeric, unit-aware** definite integrals (±∞ limits), derivatives (1st/2nd, at the current value), limits (one/two-sided, ∞), exact Σ/Π, and Desmos-style piecewise `{cond: value, …, otherwise}` |
| D28 | Error wording | **Plain language about the screen**, never LaTeX tokens; empty leftover power/subscript boxes are ignored |
| D29 | Fixes from manual testing | Spelled-out unit names work as bare letters (`5 newton`, `3 metres`, `2 kilonewtons`, `4 feet`). A unit typed from a package that is off says so (with a turn-on link) instead of "T isn't defined"; a name only defined in another folder says which folder. Exponents keep digits (`10^23`). A table input column of plain numbers accepts any unit (it says what the numbers mean). |
| D30 | Name and look | **Dimensional**, styled as an engineering notebook: paper, ink, a pencil margin rule, boxed answers; light first with a graphite dark option |
| D31 | Pre-release engine fixes | E-notation (`6.02e23`, `1.5E-3`) is a number; a whole word that is an off-package unit says so (no `2slug` = s·L·µg); self-calling functions explain once; %/‰/ppm/µε drop out of products (`20 %·50 = 10`); more spelled-out names (celsius, gallons…); 1/time shows as Hz; a bare `lb` says it was read as lbm |
| D32 | Stability | Crash boundaries (one row, or the whole app with a recovery screen and export); light/dark is a per-browser preference; import checks and repairs every field; a banner warns when the browser can't save; exports are `.dimensional.json` (old `.usc.json` still import) |
| D33 | Solve, ans, copy | `solve(lhs = rhs, x[, guess | lo, hi])` by Brent's method, skipping poles; the unknown's units come from the guess, its current value or the equation (`solve(F/A = 250 MPa, A)` → an area). `ans` = the answer of the nearest row above. Each result has a copy button |
| D34 | Custom units and table paste | ⚙ Custom units: `symbol = number unit` (bag = 25 kg), usable everywhere, may build on each other. Pasting a tab/comma/semicolon block into a table fills input columns across and down |
| D35 | Toolbox: Constants and Units | Constants tab (value and unit in each tooltip); Units tab: searchable list of every unit by kind, package units shown dimmed when off; clicking inserts a chip |
| D36 | Print / PDF | ☰ → Print / save as PDF: white paper, heading with title and date, boxed answers, no controls or empty rows, rows kept whole |
| D37 | Usability | Quick fix "+ Add q =" on undefined names; focusing a definition highlights its uses; ✎ renames a definition everywhere it means that definition; Alt+↑/↓ move rows, Ctrl+. Functions, Ctrl+/ shortcuts panel; first-run welcome; DEG-mode notes; on-screen maths keyboard on touch devices |
| D41 | Dividing by a unit | Typing / (or the on-screen ÷) right after unit chips puts those chips (with any powers) on top of a new fraction and the caret in the denominator: 5 m Tab / s Tab = 5 m/s, 10 N / mm² = 10 N/mm². Anywhere else, / is the usual fraction |
| D40 | Phone keyboard | MathLive’s on-screen keyboard (touch devices) has Dimensional’s own tabs — numbers (×10ⁿ, subscript, ans, °), common units as chips, functions (trig, logs, Γ, ∫, d/dx, lim, Σ, Π, solve, piecewise, comparisons), letters and Greek — in the notebook palette (light and dark). ↵ adds a row; the page is padded by the keyboard and the Functions drawer hides while it is up; on phones row buttons show only on the row being edited. Every page is the same grid (four rows of ten, digits on top on the letter tabs) with the same bottom row ← → ( ) , = x₁ ⌫ ↵ — the one subscript key; on a physical keyboard, _ makes a subscript. Units has two pages turned by a “more ›” / “‹ back” key. Tests check every key evaluates, every page has the same shape, and no key appears twice on a page |
| D39 | Stable first paint | Nothing moves after the first frame: the page renders once MathLive and the fonts are ready (capped at 2.5 s), fields are created in the same frame they mount, and the maths fonts are declared and preloaded by the app. A browser test checks the layout shift is 0 |
| D38 | Release engineering | Deferred recalculation keeps typing responsive on big sheets; MathLive in its own lazily loaded chunk (main bundle 122 kB gzipped); IBM Plex self-hosted; installable offline web app (manifest, icons, service worker with a build-stamped precache); share image; Playwright browser tests in Edge |

---

## 3. UI

### 3.1 Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ ☰  Untitled worksheet ✎        ↶ ↷        RAD|DEG   ⚙   ⤓ Export ⤒ Import│
├───────────────────────────────────────────────────────────────────────┤
│ + ▾ (Expression · Note · Folder · Table · Slider)   ⊟ collapse all   │
├───────────────────────────────────────────────────────────────────────┤
│ 1 │ ▾ 📁 Beam inputs                                                  │
│ 2 │   F = 6 [N]                               = 1.34885 [lbf ▾]        │
│ 3 │   A = 2 [mm]²                             = 2 [mm² ▾]              │
│ 4 │   L = 1.5 [m]   ●━━━━━━━○━━━━  0 m … 3 m                          │
│ 5 │ " Stress check per section 4.2                                    │
│ 6 │ σ = F / A                                 = 3 [N/mm² ▾]            │
│ 7 │ f(x) = x² · 4 [N/m²]                                              │
│ 8 │ f(L)                                      = 9 [N ▾]                │
│ 9 │ 5 [m] + 3 [s]                             ⚠ Can't add length and time│
│   │ ┌ table ─────────────┬──────────────┐                              │
│10 │ │ x₁ [mm ▾]          │ y₁ = f(x₁) [N ▾]│                           │
│   │ │ 10                 │ 0.0004         │                           │
│   │ │ 20                 │ 0.0016         │                           │
│   │ └────────────────────┴──────────────┘                              │
└───────────────────────────────────────────────────────────────────────┘
```

- **One full-width expression list.** It is the Desmos graphing calculator's left panel with the graph taken away. Every result sits on its own line below its input, right-aligned in a tinted display box, at every window width (D22). Plain typed values get the box too (`L = 1.5 m` → `= 1.5 m`). Results are typeset: serif digits, `×10⁻³⁴` exponents as superscripts, exact fractions stacked, units upright.
- **Row gutter:** row number, a drag handle (on hover), and an icon for the row type. A row with an error shows ⚠ in the gutter.
- **Row hover actions:** duplicate, delete, "move to folder", and "set display unit…".
- **Top bar:** worksheet title, undo/redo, RAD/DEG toggle, settings (⚙), export, import. ☰ opens a worksheet list (several worksheets in localStorage).

### 3.2 Row types

| Type | Behaviour |
|---|---|
| **Expression** | Either a definition (`X = 6 N`, `f(x) = …`) or a bare expression (`F/A`). Shows a result with a unit dropdown unless it defines a function. |
| **Note** | Plain text, started with `"` as in Desmos. |
| **Folder** | Collapsible, nestable one level (as in Desmos). Rows can be dragged in and out. Names are global by default; a definition row inside a folder has a **global / folder** switch that limits it to that folder (D24). |
| **Slider** | Any `name = number unit` definition can be turned into a slider. Min, max and step take units, in the same dimension as the value. Dragging rewrites the number in the source. |
| **Table** | Columns have a header cell (a variable such as `x₁`, or an expression such as `y₁ = f(x₁)`) and a column unit dropdown. Typed cells are numbers in the column's unit. Computed columns evaluate row by row. Each column behaves as a list variable. |

Lists (`[1, 2, 3] m`, `[1 m, 20 mm]`) are expression values, not a separate row type.

### 3.3 Result display

- `= value [unit ▾]`. The unit is a chip button that opens the unit dropdown (§6).
- Exact results show as fractions or integers. A per-row toggle (`a/b ⇄ 0.33`) switches between the exact and decimal forms, as in Desmos scientific.
- Decimal display follows the global settings: significant figures (default 10, trailing zeros trimmed); scientific notation either automatic or always on. Automatic switches below 10⁻⁶ and at a large-value threshold the user picks in Settings (10³, 10⁴, 10⁵, 10⁶, 10⁹, 10¹² by default, or never), e.g. `6.43 × 10⁶` with the threshold at 10⁶; an option for engineering notation (exponent a multiple of 3). Rows can override these.
- Rows whose display unit was chosen by hand show a small dot on the chip. The dropdown's "Reset to automatic" clears the choice.
- Dimensionless results show no chip, unless they came from cancelled units, such as strain `mm/mm`; see §5.4.

### 3.4 Settings (⚙)
Angle mode (RAD/DEG; also in the top bar), significant figures, notation mode, exact/decimal default, temperature-difference symbol style (`Δ°C` or `°C` with a "Δ" badge), theme (light/dark/system).

---

### 3.5 Function toolbox (D25)
The **ƒ(x) Functions** button in the toolbar opens a keypad drawer docked to the bottom of the window (it stays open while you work; the open state and last tab are remembered per browser). Tabs:

- **Trig:** sin, cos, tan, sec, csc, cot and their inverses, atan2(y, x), hypot, π, °.
- **Hyperbolic:** sinh, cosh, tanh, sinh⁻¹, cosh⁻¹, tanh⁻¹.
- **Powers & logs:** x², xʸ, √x, ⁿ√x, eˣ, 10ˣ, ln, log, logₐ, exp, e.
- **Rounding:** |x|, round, floor, ceil, sign, mod, gcd, lcm.
- **Special:** Γ(x), x!, nCr, nPr, erf, erfc.
- **Statistics:** mean, median, stdev, var, sum, count, min, max, list brackets.
- **Calculus:** ∫ₐᵇ dx, ∫₀^∞ dx, d/dx, d²/dx², lim, lim x→∞, Σ, Π, piecewise `{x<a: …, …}`, <, ≤, >, ≥, ∞.
- **Greek:** all lower-case letters (with ε/ϵ, θ/ϑ, ϕ/φ variants) and the capitals that differ from Latin (Γ Δ Θ Λ Ξ Π Σ Υ Φ Ψ Ω), each with a tooltip on its usual engineering meaning.

A key inserts at the caret of the expression being edited (the last one focused) and puts the caret in the first argument; clicking a key doesn't take focus away. With no expression edited yet, it starts a new row at the end. Each key's tooltip says what it does. Γ(n) and nCr/nPr/gcd/lcm are exact for whole numbers; `Γ(…)` typed directly is the gamma function unless `Γ` is a user variable.

### 3.6 Brand and look (D30)
- **Name:** Dimensional. Tagline: *Every number knows its units.* The header shows the mark, the wordmark (hidden on phones) and the worksheet title; ☰ → About Dimensional explains the tool and credits Perry Sahnow.
- **Mark:** square brackets around a bold italic *d*, after dimensional-analysis notation (`[F] = M·L·T⁻²`). Ink square; brackets and *d* in paper colour. Same drawing as the favicon.
- **Engineering notebook, light first:** warm paper (`#FBF9F4`), ink navy text (`#1F2A44`), faint blue ruled lines between rows, a single blue-grey margin rule beside the row numbers, and answers **boxed in ink** the way you box a final answer by hand. One accent, a blue pen (`#2B5CA8`), for focus and selected or active states (tabs, toggles, the slider); red is kept for errors only, so the two never look alike. Units stay teal, constants violet.
- **Dark (graphite) paper** is an option: the ☾/☀ button in the top bar, or ⚙ Theme (Light, Dark, System). New worksheets start in light.
- **Type:** the KaTeX serif for maths and results; IBM Plex Sans for the interface and Plex Mono for row numbers and labels (Google Fonts).
- Colours are CSS variables, including unit and constant chips inside the maths editor, so both themes stay consistent.

## 4. Input: typeset math and unit chips

### 4.1 Editor
- **MathLive** (`<math-field>`) for 2D typeset input: fractions with `/`, exponents with `^`, `sqrt`, subscripts with `_`, Greek letters by name (`sigma` → σ), all as in Desmos.
- MathLive's virtual keyboard is turned off.
- Enter makes a new row below; ↑/↓ move between rows; Backspace on an empty row deletes it (all as in Desmos).

### 4.2 Unit chips
A unit token is a MathLive *atom*: a custom macro, `\unit{N}`, rendered as an upright, tinted chip. The parser sees it as a unit literal, never as an identifier.

**Creating chips (autocomplete):**
1. Typing a run of letters opens an autocomplete popover once the run matches a known unit symbol or name (`N`, `newton`, `mm`, `lbf`, `psi`, `degC`).
2. **Auto-chip rule:** if the letter run follows a number or a closing bracket (`6N`, `(2+3)mm`) and exactly matches a unit symbol, it becomes a chip as soon as the next non-letter character is typed or focus leaves the row.
3. Anywhere else, such as a standalone `N`, the run stays an identifier unless:
   - the user picks the unit from autocomplete (Tab or Enter), **or**
   - the run is not a defined variable and matches a unit symbol. It is then **auto-chipped** as the unit (D17), so `F / N` just works. If the user later defines a variable with that name, existing chips stay units; only new, unchipped runs bind to the variable.
4. **Backspace on a chip** turns it back into its plain letters (identifier), with the cursor at the end.
5. Ambiguous symbols open the popover even after a number, so the user can choose:
   - `min` (minute) or the `min()` function. `min(` with a parenthesis is always the function.
   - `m` (metre) or a defined variable `m`. The defined variable wins, even after a number (D21); use the chip from autocomplete to mean the metre. When the typed letters are exactly a defined name, that variable is the **first** suggestion (so Tab keeps it a variable) and the unit comes next.
   - `g` (gram) or `g₀` (standard gravity, a constant).
   - `lb` (lbm or lbf). It always prompts, and falls back to lbm if you don't pick (D20).
   - `Pa` or a variable `P` times `a`. Implicit multiplication of single-letter variables, as in Desmos, happens only for runs that are not unit chips.
6. Prefix handling: `mm`, `kN`, `MPa`, `µm` (also typed as `um`), `GHz`. SI prefixes can go on SI units only; the dropdown never offers `kft`.
7. Compound units are made of chips plus ordinary operators: `[N]/[mm]²`, `[kg]·[m]/[s]²`. A product of chips with no operator between them (`N m`) is implicit multiplication.

**Constants** (`c`, `g₀`, `G`, `h`, `ħ`, `k_B`, `N_A`, `e`(charge), `ε₀`, `μ₀`, `R`, `σ_SB`, `m_e`, `m_p`, `atm`) come from autocomplete as **constant chips** in a different tint. `e` on its own is still Euler's number; the elementary charge is `q_e`.

### 4.3 Grammar (after MathJSON)
MathLive emits MathJSON. A thin adapter turns it into our AST:

```
Row         := Definition | FunctionDef | Expr
Definition  := Ident "=" Expr
FunctionDef := Ident "(" Params ")" "=" Expr
Expr        := standard precedence: + − · / ^ implicit-mult, unary −, postfix !, %
Primary     := Number | UnitLiteral | ConstLiteral | Ident | Call | List | "(" Expr ")"
            |  Number UnitExpr            (number–unit juxtaposition binds tighter than ·)
List        := "[" Expr ("," Expr)* "]"
```

Binding rule: `6 N/mm²` reads as `6 · (N/mm²)`. A number followed by a unit expression binds tighter than any operator, so `1/2 m` is ½ m and `2 m²` is 2·(m²), not (2 m)².

---

## 5. Quantity model and math engine

### 5.1 Core types

```ts
// Dimension exponents. 'angle' is a pseudo-dimension so rad/° can be told apart and checked.
type Dim = { L: Q; M: Q; T: Q; I: Q; Θ: Q; N: Q; J: Q; A: Q };  // Q = rational exponent

type Num = { kind: 'exact'; n: bigint; d: bigint }   // reduced rational, d > 0
         | { kind: 'float'; v: number };

// A unit expression: an ordered product of named units raised to rational powers.
// Order is kept so the "first operand" rules work and display stays stable.
type UnitTerm = { unit: UnitId; power: Q };
type UnitExpr = UnitTerm[];

interface Quantity {
  si: Num;              // magnitude in coherent SI base units (the hidden value)
  dim: Dim;
  unit: UnitExpr;       // display unit (automatic or chosen by the user)
  unitSource: 'auto' | 'user' | 'inherited';
  tempKind?: 'absolute' | 'delta';   // only when dim is pure Θ
}
```

**The invariant:** the shown number is always `toUnit(si, unit)`, computed at display time from the hidden SI magnitude. The UI never shows a number that is not in the unit printed beside it.

### 5.2 Exact arithmetic
- Rationals use `bigint` and stay exact through `+ − · /`, integer powers, and conversions with exact factors.
- Unit conversion factors are stored as exact rationals wherever the definition is exact. Most engineering units are: in = 0.0254 m, lbm = 0.45359237 kg, lbf = lbm·9.80665 m/s², psi = lbf/in², BTU_IT, hp (mechanical) = 550 ft·lbf/s, gal = 231 in³. So `6 N → lbf` gives an exact rational. It is *shown* as a decimal by default (unit conversions turn on decimal display), with the fraction available from the toggle.
- The value becomes a float once it goes through an irrational operation: `√` of a non-square, trig, `exp`/`ln`, π, constants that are not exact (G, measured masses), or a fractional power. A float stays a float; it is never turned back into a rational.
- Display picks exact or decimal like this: exact results whose denominator is ≤ 10⁶ and which have no unit conversion default to the fraction or integer form. Everything else defaults to decimal.

### 5.3 Operations and units

| Operation | Dimension rule | Display unit rule |
|---|---|---|
| `a + b`, `a − b` | dims must be equal, else error | **first operand's unit** (D9) |
| `a · b`, `a / b` | add/subtract dims | concatenate unit exprs, then **smart simplify** (§5.4) |
| `a ^ n` | n must be dimensionless; dim·n | each unit power × n (`(mm)^2` → `mm²`) |
| `√a`, `ⁿ√a` | dim / n (rational exponents allowed) | powers ÷ n (`√(mm²)` → `mm`); a fractional unit power is allowed but warned |
| `sin cos tan …` | arg must be angle or dimensionless | dimensionless result |
| `asin acos atan atan2` | arg dimensionless (atan2: same dims) | result in **rad**, or **°** in DEG mode |
| `exp ln log` | arg must be dimensionless | dimensionless |
| `abs floor ceil round mod min max` | preserve dims (min/max/mod: same dims) | first argument's unit |
| `round(x, unit)` | e.g. `round(L, mm)` | rounds in that unit |
| list ops `sum mean min max` | elements share dim | first element's unit |
| `stdev, var` | var → dim² | first element's unit (squared for var) |

Trig with **bare numbers** uses the global RAD/DEG mode. Trig with **angle-tagged** values ignores the mode: `sin(30°)` = ½ in either mode.

Comparisons (`<`, `>`, `≤`, `≥`, `=`, `≠`, chained like `0 < x < 10`) are used in piecewise conditions (§5.10). They need equal dimensions; a bare 0 or ∞ compares with anything.

### 5.4 Smart simplify (D5, D13)
These rules run after every `·` and `/`, in order:

1. **Cancel identical units.** `N·m / m` → `N`.
2. **Merge same-dimension units into the first one's unit (D16).** `3 mm · 2 m` → `6000 mm²`; `N/mm² · m²` → `N`. Only units of the *same base dimension* merge (lengths with lengths), never across different named compounds.
3. **Collapse messy forms.** If the expression still has only SI base units (or base units plus at most one named unit) and matches a named coherent unit exactly, it collapses: `kg·m/s²` → `N`, `kg/(m·s²)` → `Pa`, `A·s` → `C`, `N/m²` stays `N/m²` (it was written by the user from named units; see rule 4).
4. **Keep products of named units.** If every factor was already a named unit the user typed or inherited (`N·m`, `N/mm²`, `kW·h`), keep it as written. The collapsed form (`J`, `MPa`, `kWh`) goes first in the dropdown's suggestions.
4b. **…unless the product turns one named unit into another (D23).** `MPa·mm²` → `N`, `kPa·m²` → `kN`, `V·A` → `W`, `Pa·m³` → `J`, `J/s` → `W`. The prefix is picked so the value doesn't change; if none fits, the product is kept. Conventional forms are still kept as written: stresses (`N/mm²`) and energy built from a force or power (`N·m`, `kW·h`).
5. **Fully dimensionless result.**
   - If it came from cancelling identical units it shows nothing (`m/m` → no unit).
   - If it came from *different* units of the same dimension (`mm/m`), it is reduced to a pure number with the conversion applied, and the dropdown offers `mm/m`, `%`, `‰`, `ppm`, `µε` (strain).
6. **Angles.** `rad` is kept through multiplication (`rad/s`, so angular velocity is clear). `rad·m` (arc length) is shown as `m` with `rad·m` in the dropdown.

Each rule is a separate, unit-tested pass in `simplify.ts`. Weights and tie-breakers live in one table so they can be tuned.

### 5.5 Temperature (affine units)
- `°C`, `°F` are **absolute** by default. `Δ°C`, `Δ°F` (and `K`, `°R`, which have no offset) are **deltas**.
- Rules:
  - abs + Δ → abs; abs − abs → Δ; abs − Δ → abs; Δ ± Δ → Δ.
  - abs + abs → error: "Can't add two absolute temperatures; did you mean a temperature difference?"
  - Multiplying or dividing an absolute °C/°F value (e.g. `ρ·c_p·T`) → error, with a quick-fix offering to use K or Δ°C.
  - `K` and `°R` take part in multiplication freely.
- When converting units inside a compound unit (`J/(kg·°C)`), `°C` means Δ°C: it is a temperature *interval*. The dropdown labels it as such.
- The display dropdown for an absolute temperature offers absolute units only (K, °C, °F, °R). For a delta it offers delta units.

### 5.6 Angles
- Angle units: `rad`, `°`, `arcmin` (′), `arcsec` (″), `grad`, `rev`/`turn`.
- `rad` counts as dimensionless where physics needs it (`ω·r` where ω in rad/s → m/s). This is done by letting `A` (angle) exponents cancel to 0 when the result is shown in a non-angle unit. Strict mismatches (`30° + 2 m`) are still errors.

### 5.7 Variables, functions, dependency graph
- **Scope (D24).** Names are global by default. A variable or function defined inside a folder can be switched to **folder** scope with the pill on its row (`◎ global` / `▣ folder`; the folder pill stays visible). Then:
  - Rows inside that folder (expressions and tables) see the folder's own definition first, then globals. So folder A can have `F = 3 N` and folder B `F = 5 N`, and each folder's `2F` uses its own.
  - A folder definition may shadow a global of the same name; only that folder is affected, and the pill's tooltip says it overrides the global.
  - Rows outside the folder can't see it. A bare `F` there falls back to its normal meaning: a global `F`, or the farad (D17).
  - When that fallback is a unit or constant (`F` → farad), the row shows a warning naming the folder that defines `F`, and the bare letters are **not** auto-chipped, so the reading stays open. Picking the chip from autocomplete means the unit on purpose and clears the warning.
  - Lookups are lexical: a row is always computed in the folder it sits in, even when it defines a global (`G = 2F` inside A uses A's `F` everywhere `G` is used). Functions also look names up where they were defined.
  - Redefining a name at the same level is still an error on both rows: two globals, or two folder definitions in the same folder. A folder-scoped row moved out of its folder becomes global again. Table columns are always global.
- Redefining a global name already in use is an error on both rows, as in Desmos.
- Names: one letter, optionally Greek, with an optional subscript (`σ_max`, `F_1`, `L_beam`). Multi-letter identifiers are allowed through a subscript. Bare multi-letter runs are read as unit, function, or implicit multiplication, as in Desmos.
- **Reserved:** unit symbols *as chips* are never identifiers, so `m` can be both a variable and (as a chip) the metre unit. Constants and built-in function names are reserved.
- **Dependency graph:** each row's free identifiers become edges. A change re-evaluates the affected rows in topological order. Cycles are flagged on every row in the cycle.
- **User functions:** `f(x) = x² · 4 N/m²`. Parameters are untyped; dims are checked when the function is called (`f(3 m)` → `36 N`, `f(3 s)` → error "f: …"). Display-unit rules apply to the body on every call. Functions don't show a result.
- **Display unit inheritance (D10):** when `Z = 2·Y` reads `Y`, it gets `Y`'s *displayed* unit expression (user-chosen or automatic) as the unit of that operand, with `unitSource: 'inherited'`. The same holds for input rows: if `F = 6 N` is displayed in lbf, then `G = 2F` shows `lbf`. Choosing a new unit for `Z` itself overrides the inherited one.

### 5.8 Lists
- `[1, 2, 3] m` — a unit after a list applies to every element. `[1 m, 20 mm]` — mixed units of one dimension; the list's display unit is the first element's.
- All elements must share a dimension. Element-wise operations broadcast, as in Desmos. Lists of different lengths: the result has the shorter length.
- Results show as `[1, 2, 3] [m ▾]`, with one unit dropdown for the whole list.

### 5.9 Errors
Errors appear inline in place of the result and give the dimensions in plain words:

- `Can't add length (m) and time (s)`
- `sin expects an angle or a dimensionless number; got force (N)`
- `'q' is not defined` (+ quick-fix: "Did you mean the unit …?")
- `Circular definition: a → b → a`
- `Unit 'lbs' not found — did you mean lbm or lbf?`

---

**Wording (D28).** Messages describe what to do on screen, not the LaTeX: "Σ needs an end value: type it above the Σ", "There's an extra “)”", "Comparisons like “<” only go inside a piecewise", "“q” isn't defined yet: add a row like q = 5". An empty power or subscript box left behind after deleting its contents (`x^{}`) is ignored; an empty fraction part or root says so.

### 5.10 Calculus, Σ/Π and piecewise (D27)
All numeric and unit-aware, inside the engine (no external library understands our units). Results carry units: the integrand's unit × the variable's unit, the expression's unit ÷ the variable's unit, and so on.

| Feature | Write | Method and notes |
|---|---|---|
| Definite integral | `\int_{a}^{b} f(x)\,dx` (`dx` or `\mathrm{d}x` ends the integrand) | Adaptive Gauss–Kronrod 7/15, relative tolerance 1e-12. Limits may be ±∞ (change of variable). `x` takes the units of the limits; 0 and ∞ fit any unit. Limits can be variables (`F(t) = ∫₀ᵗ …`). Divergent integrals say so. |
| Derivative | `\frac{d}{dx} f(x)`, `\frac{d^2}{dx^2} f(x)` | Ridders' extrapolation of central differences, taken at the **current value of x**: a defined variable, or a function parameter (`g(x) = d/dx …`). Applies to the rest of the product term. Results snap to exact small fractions when within 1e-9. |
| Limit | `\lim_{x\to a} f(x)`, `a^+`/`a^-` for one side, `a = ∞` | Polynomial (Neville) extrapolation of f(a ± h) as h → 0, from both sides; reports "doesn't exist" when the sides disagree, and ±∞ when values grow without bound. |
| Sum / product | `\sum_{n=a}^{b}`, `\prod_{n=a}^{b}` | Exact, whole-number bounds, up to a million terms. Empty range: 0 / 1. `\sum(list)` without bounds is still the list function. |
| Piecewise | `\left\{x<0: -x, x\right\}` | Desmos style: `condition: value` items separated by commas; the first true condition wins; a last item without a condition is the "otherwise" value; with none, no match is an error. `{x>0}` alone means 1 when true. |

The bound variable is parsed as a variable inside its body, so `t`, `s` or `m` there aren't read as units. Trig on a bare integration/limit variable follows the RAD/DEG mode like everywhere else. The toolbox has a **Calculus** tab for all of these (§3.5).

## 6. Unit dropdown

It appears on every result chip, every slider value, and every table column header.

```
┌ Display as ─────────────────────┐
│ 🔍 type a unit…  (e.g. kip/in²)  │
├ Suggested ──────────────────────┤
│ • N/mm²   (current, automatic)  │
│   MPa                           │
│   Pa       ·  kPa  ·  GPa       │
├ US customary ───────────────────┤
│   psi   ·  ksi  ·  lbf/ft²      │
├ Other ──────────────────────────┤
│   N/m²  ·  bar  ·  kgf/cm²  · atm│
├─────────────────────────────────┤
│ ↺ Reset to automatic            │
└─────────────────────────────────┘
```

- **Candidates** come from the dimension: every catalogue unit and every registered compound unit with the same `Dim` (and the same `tempKind`). They are ranked:
  1. the current or automatic unit;
  2. the collapsed named unit (rule 4 of §5.4);
  3. SI prefixed variants, with the "nicest" prefix for the current magnitude (fewest digits, value in [1, 1000)) first;
  4. units in the same system as the inputs (US customary if any input was imperial);
  5. everything else.
- **Free-form entry:** the search box accepts any unit expression (`kip/in²`, `N·mm`, `lbf·ft`). The entry is checked against the dimension as you type, and a red hint shows when it doesn't match.
- **Changing the unit** only changes how the row is displayed (`unit`, `unitSource = 'user'`). Source text is never rewritten (D3). On an input row such as `G = 3 m` → yd, the row keeps showing the typed `G = 3 m` and shows `= 3.280839895 yd` below it (D18). When no unit is chosen, an input row still shows its result box (`= 3 m`) for consistency (D22). Dependent rows that inherited the unit update their display unit, but never their value.
- For a dimensionless result the dropdown offers `(none)`, `%`, `‰`, `ppm`, plus angle units if the value came from an angle.

---

## 7. Unit catalogue (v1)

The catalogue is a data file (`units.data.ts`). Each entry: `id`, symbols/aliases, `dim`, exact or float `factor` to SI, `offset` (affine units only), `system` (SI, SI-accepted, US, Imperial-UK, CGS), whether it `prefixable`, and a `category` for grouping in the dropdown.

| Quantity | Units |
|---|---|
| Length | m (all prefixes), in, ft, yd, mi, nmi, mil/thou, µin, Å, au, ly, pc |
| Area | m², ha, acre, in², ft², yd², mi², circular mil |
| Volume | m³, L (prefixes), mL, cc, in³, ft³, yd³, gal (US), qt, pt, cup, fl oz (US), tbsp, tsp, bbl (oil), gal_UK, pt_UK, fl oz_UK, acre·ft |
| Mass | g (prefixes), t (tonne), lbm (`lb`), oz, slug, ton (short), ton_UK (long), gr, u/Da |
| Time | s (prefixes), min, h, d, wk, yr (365.25 d) |
| Force | N (prefixes), lbf, kip, ozf, kgf, dyn, pdl, tonf |
| Pressure / stress | Pa (prefixes), bar, mbar, atm, psi, ksi, psf, mmHg, inHg, inH₂O, Torr, kgf/cm² |
| Energy | J (prefixes), Wh, kWh, cal, kcal, BTU (IT), therm, eV, erg, ft·lbf, in·lbf |
| Power | W (prefixes), hp (mech), hp_metric, BTU/h, ton_refrigeration, ft·lbf/s |
| Torque | N·m, kN·m, N·mm, lbf·ft, lbf·in, kip·ft (shown as compounds) |
| Velocity | m/s, km/h, mph, ft/s, kn |
| Acceleration | m/s², ft/s², g₀ (as constant), Gal |
| Temperature | K, °C, °F, °R, plus Δ°C, Δ°F |
| Angle | rad, °, ′, ″, grad, rev |
| Frequency / angular | Hz (prefixes), rpm, rad/s |
| Electrical | A, V, Ω, S, F, H, C, Wb, T, Ah, mAh (all SI-prefixable) |
| Amount, light | mol, cd, lm, lx |
| Flow | m³/s, L/min, gpm, cfm |
| Density | kg/m³, g/cm³, lbm/ft³, lbm/in³ |
| Viscosity | Pa·s, P, cP, St, cSt |
| Data (bonus, cheap) | bit, B, with SI and binary prefixes (kB, KiB) |

**Constants** (CODATA 2022, exact where SI defines them): c, h, ħ, q_e, k_B, N_A, R, G, g₀, ε₀, μ₀, σ_SB, m_e, m_p, m_n, a₀, atm (as a constant pressure), plus R_air for engineering use.

**Registered compounds** (for dropdown suggestions): N/mm², N·m, N·mm, kN·m, lbf·ft, lbf·in, kip·ft, kip/in², J/(kg·K), W/(m·K), W/(m²·K), BTU/(lbm·°F), BTU/(h·ft²·°F), and so on. This list gives the dropdown sensible compound options beyond the single-unit catalogue.

---

### 7.1 Unit packages (D26)
Everyday units are always on (the **base set**). Specialist units live in **packages** that each worksheet turns on in ⚙ Settings → Unit packages (saved with the worksheet). Packages overlap. Defined in `units/packages.ts`; any unit not listed there is base.

| Package | Adds |
|---|---|
| Mechanical engineering | kip, ksi, psf, tonf, ozf, pdl, slug, kgf, short ton, mil, µin, inHg, inH₂O, rpm, gpm, cfm, TR, BTU, therm, metric hp, °R, µε, poise, stokes, barrel, gradian |
| Electrical engineering | F, H, S, Wb, T, gauss, VA, VAr, Ah, circular mil, mil, lm, lx |
| Physics | eV, Å, au, ly, pc, Da, dyn, erg, Gal, P, St, Gy, Sv, Bq, Ci, barn, torr, mmHg, F, H, S, Wb, T, gauss, lm, lx |
| Chemistry | molar (M = mol/L), katal, Da, Å, eV, torr, mmHg, grain, Bq, Ci |
| Cooking | cup, tbsp, tsp |
| UK imperial | imperial gallon, pint, fluid ounce, long ton |

A unit that is off is not recognised from bare letters (so `F` stays free for a force variable unless Electrical or Physics is on), not offered in autocomplete, and not listed in unit dropdowns; a longer run falls back to base units (`VA` → V·A). A unit **chip** from a package that is off still calculates, and its row says which package provides it, with a button to turn that package on. Free-form entry in a unit dropdown accepts any unit. Prefixed units follow their base unit (`mM` is Chemistry). Constants are not packaged.

## 8. Architecture

### 8.1 Stack
- **Vite + React 18 + TypeScript (strict).**
- **MathLive** for the math fields (custom `\unit{}` and `\const{}` macros, virtual keyboard off).
- **Zustand** for app state (rows, settings, undo stack). **Immer** for immutable row updates.
- **No mathjs.** Its unit system has no exact rationals, no ordered "first operand" display units, and no affine-delta rules. A purpose-built engine of about 2–3k LOC is easier to reason about and test.
- **Vitest** for unit tests, **Playwright** for end-to-end tests.
- Evaluation runs on the main thread first (worksheets are small). The engine is a pure module so it can move to a Web Worker later without changes.

### 8.2 Module layout

```
src/
  engine/                 # pure TS, no React; fully unit-tested
    rational.ts           # bigint rational arithmetic
    num.ts                # Num = exact | float, promotion rules
    dim.ts                # dimension vectors, names ("force", "length")
    units/
      units.data.ts       # catalogue (§7)
      constants.data.ts
      compounds.data.ts
      registry.ts         # lookup by symbol/alias, prefix expansion
      parseUnit.ts        # free-form unit-expression parsing (dropdown search)
    quantity.ts           # Quantity ops: add/mul/pow/convert, temperature rules
    simplify.ts           # §5.4 passes
    ast.ts                # AST types
    fromMathJson.ts       # MathJSON → AST (unit/const chips → literals)
    evaluate.ts           # AST → Quantity | List | Error
    builtins.ts           # functions table with dim signatures
    graph.ts              # dependency graph, topological order, cycles
    format.ts             # Quantity → display string (sig figs, notation, fraction)
  state/
    store.ts              # Zustand: worksheet, rows, settings, undo/redo
    persistence.ts        # localStorage autosave (debounced), JSON export/import, schema migration
  ui/
    App.tsx, TopBar.tsx, ExpressionList.tsx
    rows/ExpressionRow.tsx, NoteRow.tsx, FolderRow.tsx, SliderRow.tsx, TableRow.tsx
    MathInput.tsx         # MathLive wrapper + chip autocomplete
    UnitAutocomplete.tsx
    UnitDropdown.tsx
    ResultChip.tsx
    Settings.tsx
```

### 8.3 Evaluation flow
1. A row edit gives new LaTeX/MathJSON → `fromMathJson` → AST, which is stored on the row.
2. `graph.ts` recomputes the row's defined name and dependencies, and returns the dirty set (the row plus everything downstream of it).
3. `evaluate` runs over the dirty set in topological order and produces a `Quantity` (or error) per row.
4. Each row's display unit is worked out: the user's choice, else the inherited unit, else the automatic one (`simplify`).
5. `format` renders the value in the display unit.

A display-unit change skips steps 1–3: only rows that inherit that unit re-run steps 4–5.

### 8.4 Saved format (JSON)

```json
{
  "schema": 1,
  "title": "Beam check",
  "settings": { "angle": "rad", "sigFigs": 10, "notation": "auto", "exactDefault": true },
  "rows": [
    { "id": "r1", "type": "folder", "title": "Beam inputs", "collapsed": false },
    { "id": "r2", "type": "expr", "parent": "r1", "latex": "F=6\\unit{N}", "displayUnit": "lbf" },
    { "id": "r3", "type": "expr", "parent": "r1", "latex": "A=2\\unit{mm}^2" },
    { "id": "r4", "type": "slider", "parent": "r1", "latex": "L=1.5\\unit{m}",
      "min": "0 m", "max": "3 m", "step": "0.1 m" },
    { "id": "r5", "type": "note", "text": "Stress check per section 4.2" },
    { "id": "r6", "type": "expr", "latex": "\\sigma=\\frac{F}{A}", "displayUnit": "MPa", "displayMode": "decimal" },
    { "id": "r7", "type": "table", "columns": [
        { "header": "x_1", "unit": "mm", "values": ["10", "20"] },
        { "header": "y_1=f(x_1)", "unit": "N" } ] }
  ]
}
```

- Only the source (LaTeX), the user's display-unit choices, and display options are saved. Results are always recomputed on load.
- Autosave goes to `localStorage["usc:worksheets"]` (an index) and `usc:ws:<id>`, debounced at 500 ms. Export downloads `<title>.dimensional.json` (older `.usc.json` files still import); import checks every field and repairs or drops anything malformed (D32).

---

## 9. Undo/redo
The undo stack is per worksheet and holds whole-row snapshots. It covers text edits (merged into one step per row-focus session), row add/delete/move, folder changes, slider drags (one step per drag), and display-unit changes. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.

---

## 10. Accessibility and keyboard
- MathLive fields expose speakable text. Result chips have `aria-label`s such as "3 newtons per square millimetre, change unit".
- The unit dropdown can be used with the keyboard alone (opens on Alt+↓; type to filter).
- Unit-chip colours meet WCAG AA in both themes. Chips also differ by shape (rounded border), not just colour.

---

## 11. Testing strategy
- **Browser tests (Playwright, `npm run test:e2e`, D38):** typing with chips and live results, `*` → `·` and multi-digit exponents, unit dropdown search and conversion, toolbox insertion, drag-and-drop keeping chips, undo/redo, export → import round-trip, no sideways scroll at 375 px.
- **Engine tests (Vitest)**, a table of `input → expected value + display unit`:
  - `6 N / 2 mm²` → `3 N/mm²`; dropdown → MPa `3`; → psi `435.113…`
  - `2 m + 30 mm` → `2.03 m`; `30 mm + 2 m` → `2030 mm`
  - `(2 kg)(3 m/s²)` → `6 N`; `5 N · 2 m` → `10 N·m` (J offered)
  - `mm · m` → `mm²`; `mm/m` → dimensionless with `‰` offered
  - `6 N → lbf` exact rational = 6 / (0.45359237·9.80665)
  - `20 °C + 5 Δ°C` → `25 °C`; `20 °C + 5 °C` → error; `30 °C − 10 °C` → `20 Δ°C`
  - `sin(30°)` → `1/2` in both modes; `sin(30)` in DEG mode → `1/2`
  - `√(4 mm²)` → `2 mm`; `√2` → float
  - Inheritance: Y shown in MPa ⇒ `2Y` shown in MPa
  - Errors: `5 m + 3 s`, cycles, unknown identifiers
- **Property tests:** converting to any same-dim unit and back is the identity (exact units give exact equality).
- **Catalogue tests:** every factor checked against NIST SP 811 values.
- **E2E (Playwright):** chip autocomplete, Backspace turning a chip into text, dropdown changes, folder drag-and-drop, slider dragging, export → import round-trip.

---

## 12. Milestones

| M | Scope |
|---|---|
| M1 | Engine core: rationals, dims, catalogue, Quantity ops, simplify, format. CLI test harness. |
| M2 | Expression list UI: MathLive rows, unit-chip autocomplete, results with unit dropdown, variables, dependency graph, errors. |
| M3 | Persistence (autosave, export/import), undo/redo, settings, notes, folders, drag-and-drop. |
| M4 | User functions, lists, sliders. |
| M5 | Tables, temperature-delta polish, accessibility pass, catalogue completion. |

---

## 13. Open questions and deferred items
1. **User-defined units** (`1 smoot = 1.7018 m`): deferred from v1. The registry is designed to accept runtime entries.
2. ~~`lb` alias~~: resolved (D20).
