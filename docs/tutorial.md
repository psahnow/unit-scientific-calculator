# Onboarding: start card, guided tour, inline tips (D60)

The "Beam check" sample is gone. A first visit opens an empty worksheet. Learning happens three ways, from lightest to heaviest:

1. **Start card**: shown on any empty worksheet.
2. **Inline tips**: shown once each, the first time something new appears.
3. **Guided tour**: optional, hands-on, about 2 minutes.

None of these blocks the worksheet or moves it around. Everything can be dismissed, and nothing comes back once dismissed.

## 1. First visit

```
┌ ☰ Dimensional / Untitled worksheet ──────────── ↶ ↷ RAD|DEG ⚙ ?  ┐
│ + Add ▾                                                ƒ(x) Functions │
├───────────────────────────────────────────────────────────────────────┤
│ 1 │ |                                                                 │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │ Every number knows its units.                                 │   │
│   │ Type a value with a unit, like F = 6 kN, or try one:          │   │
│   │  [ F = 6 kN ]  [ 6 kN / 20 mm² ]  [ 3 ft + 1 m ]  [ 100 km/h in m/s ]│
│   │ ▶ Take the 2-minute tour        Ctrl / shortcuts · saved here │   │
│   └───────────────────────────────────────────────────────────────┘   │
│ + Add expression                                                      │
└───────────────────────────────────────────────────────────────────────┘
```

- The start card replaces the floating welcome popup. It sits in the worksheet flow under the last row.
  - It appears whenever every row is an empty expression: first visit, + New worksheet, or after clearing a sheet.
  - It is rendered at first paint, so nothing shifts when the page loads.
- Clicking an example puts it in the empty row as real input (unit chips included) and focuses the end of the row. The result appears at once and the card goes away. The examples show:
  - a definition;
  - automatic derived units;
  - mixed systems;
  - a conversion.
- "Take the 2-minute tour" starts the tour (§3).
- It is also in ? Help as "Take the tour".

## 2. Inline tips (one each, ever)

A tip is a small line under the row that triggered it, in the same quiet style as row notices:

```
ⓘ <text>  [Got it]
```

- Only one tip shows at a time: the first one, in worksheet order, that applies and hasn't been dismissed.
- Tips never show during the tour, because the tour covers the same ground.
- Dismissed tips are remembered per browser (`dimensional:tips`). Doing what a tip suggests also dismisses it: opening the unit menu dismisses the unit tip.

| Tip | Shows under | Text |
|---|---|---|
| `unit` | the first result that has a unit | Click the unit to see this result in another one. Only the display changes; the value stays exact. |
| `func` | the first function definition | Use it like f(2 m). To check an input's unit, type it: f(l: m) accepts any length and converts it to metres. |
| `folder` | the first row inside a folder | Names defined here work everywhere. Click 🌐 in the margin to keep one inside this folder. |
| `table` | the first table | Name a column y₁ = f(x₁) to calculate it from another column. Give a column a unit with its unit button. |
| `ref` | the first plain answer row (no name) when there are 3+ rows | Use #n to reuse row n's answer, like #2 · 3. It follows the row if you move it. |

Settings gets short help lines where the meaning isn't obvious:

- Notation: Auto / Scientific / Engineering.
- Show exact fractions.
- Scientific notation from.

## 3. The guided tour

**Where it runs.** The tour opens a new worksheet called "Tour", so the user's own work is never touched.

**Ending it:**
- ✕ at any point goes back to the worksheet you were on and deletes the Tour sheet.
- The last step offers two choices: keep the Tour sheet as a reference, or delete it and go back.

**The coach card.**
- Desktop: a floating card in the bottom-right corner, where the welcome card used to be.
- Phone: inside the pinned header, compact, so the on-screen keyboard never covers it.
- It shows:
  - the step, n of 8;
  - a title and one or two sentences;
  - the goal, as something to type;
  - "Show me", which does the step for you (useful on phones);
  - Back / Skip, or Next once done;
  - ✕.

**Spotlight.** The step's target gets a pulsing accent outline. There is no dark overlay, so everything stays usable.

**Moving on.**
- Each goal is checked live against the worksheet.
- When it is met, the card shows ✓ and moves on after a short pause (about 1.2 s with no more edits), so finishing a row then pressing Enter feels natural.
- Next works at any time.

| # | Title | The user does | Goal (checked live) | Spotlight |
|---|---|---|---|---|
| 1 | Numbers carry units | Type `F = 6 kN`. A suggestion appears as you type the unit: Tab (or keep typing) turns it into a unit chip | a row defines F as a force | the first empty row |
| 2 | Units do the arithmetic | Enter for a new row, `A = 20 mm^2`, then a row `F / A` | an unnamed row's result is a pressure | the newest empty row |
| 3 | Show it your way | Click the unit beside F / A's result and pick MPa | that row has a display unit | that row's unit button |
| 4 | Mistakes are caught | Type `F + A`. Hover ⚠ to read why | a row has a unit-mismatch error | the error row's margin |
| 5 | Change one, update all | Change F to 8 kN: every result follows | F ≠ 6 kN | F's row |
| 6 | Reuse an answer | Type `#n · 2`, where n is F / A's row number (given in the card) | a row uses #n and has a value | the newest empty row |
| 7 | Functions and constants | Open ƒ(x) Functions: trig, calculus, solve, roots, physical constants | the drawer is open | the ƒ(x) button |
| 8 | That's it | Pointers: + Add for notes, folders and tables · ⚙ for unit sets and custom units · Ctrl / for shortcuts · ☰ → Export keeps a copy. [Keep the Tour sheet] [Delete it and go back] | — | — |

"Show me" inserts the step's rows (or opens the unit menu / drawer) and leaves the caret at the end.

On step 4, the error row is removed again when the user leaves the step, so later steps have no ⚠ hanging around.

## 4. Implementation

- `src/ui/tour.ts` (pure, unit-tested in `tests/tour.test.ts`). It holds:
  - the step list (title, body, goal(rows, result), target selector, showMe(store));
  - the tip rules (which row, which text).
- `src/ui/Onboarding.tsx` holds:
  - `StartCard`;
  - `Coach`;
  - `Tip` (rendered by ExpressionRow / TableRow via `ctx.tip`).
- Store additions:
  - `tour: { step, prevWs, wsId } | null`;
  - `startTour()`, `setTourStep(n)`, `endTour(keep)`;
  - `tipsSeen`, `dismissTip(id)`.
- The tour isn't saved across reloads. A reload ends it, and the Tour sheet stays in ☰ like any other worksheet.
- Tests:
  - unit tests for every goal and tip rule against real evaluations;
  - e2e:
    - a first visit shows the start card;
    - an example inserts and evaluates;
    - the whole tour completes using only "Show me";
    - ✕ restores the previous sheet;
    - a tip shows once and stays dismissed.
