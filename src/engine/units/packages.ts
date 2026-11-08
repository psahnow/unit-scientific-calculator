// Unit packages (DESIGN.md §7.1, D26). Every unit not listed in a package is in the always-on
// base set. A worksheet enables packages in Settings; a package unit is then recognised when
// typed, offered in autocomplete and listed in unit dropdowns. Units may be in several packages.
import type { UnitDef } from './units.data';

export interface UnitPackage {
  id: string;
  name: string;
  description: string;
  units: string[];
}

export const PACKAGES: UnitPackage[] = [
  {
    id: 'mechanical',
    name: 'Mechanical engineering',
    description: 'kip, ksi, psf, slug, BTU, °R, rpm, gpm, cfm, inH₂O, refrigeration tons, viscosity',
    units: [
      'kip',
      'ksi',
      'psf',
      'tonf',
      'ozf',
      'pdl',
      'slug',
      'kgf',
      'ton',
      'mil',
      'µin',
      'inHg',
      'inH2O',
      'rpm',
      'gpm',
      'cfm',
      'TR',
      'BTU',
      'thm',
      'hp_M',
      '°R',
      'µε',
      'P',
      'St',
      'bbl',
      'grad',
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical engineering',
    description: 'farad, henry, siemens, weber, tesla, gauss, VA, VAr, Ah, circular mils, lumen, lux',
    units: ['F', 'H', 'S', 'Wb', 'T', 'Gs', 'VA', 'VAr', 'Ah', 'cmil', 'mil', 'lm', 'lx'],
  },
  {
    id: 'physics',
    name: 'Physics',
    description: 'eV, Å, au, light-years, parsecs, dalton, CGS (dyn, erg, Gal, P, St), radiation, barn, EM units',
    units: [
      'eV',
      'Å',
      'au',
      'ly',
      'pc',
      'Da',
      'dyn',
      'erg',
      'Gal',
      'P',
      'St',
      'Gy',
      'Sv',
      'Bq',
      'Ci',
      'b',
      'Torr',
      'mmHg',
      'F',
      'H',
      'S',
      'Wb',
      'T',
      'Gs',
      'lm',
      'lx',
    ],
  },
  {
    id: 'chemistry',
    name: 'Chemistry',
    description: 'molar (M), katal, dalton, Å, eV, torr, mmHg, grain, Bq',
    units: ['M', 'kat', 'Da', 'Å', 'eV', 'Torr', 'mmHg', 'gr', 'Bq', 'Ci'],
  },
  {
    id: 'cooking',
    name: 'Cooking',
    description: 'cups, tablespoons, teaspoons',
    units: ['cup', 'tbsp', 'tsp'],
  },
  {
    id: 'imperial-uk',
    name: 'UK imperial',
    description: 'imperial gallon, pint, fluid ounce, long ton',
    units: ['gal_UK', 'pt_UK', 'floz_UK', 'ton_UK'],
  },
];

export const PACKAGE_BY_ID = new Map(PACKAGES.map((p) => [p.id, p]));
const PACKAGES_OF = new Map<string, string[]>();
for (const p of PACKAGES) for (const id of p.units) PACKAGES_OF.set(id, [...(PACKAGES_OF.get(id) ?? []), p.id]);

/** The catalogue unit a (possibly prefixed) unit comes from: kPa → Pa. */
const rootId = (u: UnitDef) => u.prefixOf ?? u.id;

/** Packages that provide this unit; empty for base units. */
export function packagesOf(u: UnitDef): string[] {
  return PACKAGES_OF.get(rootId(u)) ?? [];
}

export type Availability = (u: UnitDef) => boolean;

/** Which units are on for a set of enabled packages. `undefined` means every unit (engine default). */
export function availability(enabled: readonly string[] | undefined): Availability {
  if (!enabled) return () => true;
  const on = new Set(enabled);
  return (u) => {
    const pk = packagesOf(u);
    return !pk.length || pk.some((p) => on.has(p));
  };
}

// The UI's current worksheet packages (autocomplete and dropdowns read this; the engine is passed it).
// Installed by the store whenever the worksheet's packages change (state/store.ts), never while
// rendering, so every render sees the same value.
let current: Availability = availability([]);
export function setCurrentPackages(enabled: readonly string[]) {
  current = availability(enabled);
}
export const isUnitOn: Availability = (u) => current(u);

/** Why a unit expression can't be used with these packages, or null if it can (D59). */
export function offPackageMessage(unit: { id: string }[], getUnitDef: (id: string) => UnitDef, on: Availability): string | null {
  for (const t of unit) {
    const u = getUnitDef(t.id);
    if (on(u)) continue;
    const names = packagesOf(u).map((id) => PACKAGE_BY_ID.get(id)?.name ?? id);
    return `${u.id} is in the ${names.join(' / ')} unit set, which is off for this worksheet. Turn it on in ⚙ Settings, or pick another unit.`;
  }
  return null;
}
