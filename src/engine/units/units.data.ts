// Unit catalogue (DESIGN.md §7). Factors are exact rationals wherever the definition is exact.
import { type Dim, dim } from '../dim';
import { type Num, parseDecimal as D, mul, div, powRational, float, exact } from '../num';

export type UnitSystem = 'SI' | 'SI-accepted' | 'US' | 'UK' | 'CGS' | 'other';

export interface UnitDef {
  id: string; // canonical symbol, e.g. "N", "lbf", "°C"
  aliases: string[]; // extra accepted spellings (ASCII-friendly)
  name: string;
  dim: Dim;
  factor: Num; // multiply a value in this unit by factor → SI coherent value
  offset?: Num; // affine offset in K (°C: 273.15)
  tempKind?: 'absolute' | 'delta';
  system: UnitSystem;
  prefixable?: boolean;
  category: string;
  /** SI base unit (m, kg, s, A, K, mol, cd, rad). */
  base?: boolean;
  /** Named coherent SI unit eligible for smart-simplify collapse (N, Pa, J…). */
  coherentNamed?: boolean;
  /** Prefixes suggested in the dropdown. */
  commonPrefixes?: string[];
  /** Ambiguous symbol: always prompt in autocomplete (e.g. lb). */
  ambiguous?: string[];
  /** For a prefixed unit (kPa), the catalogue unit it is built on (Pa). */
  prefixOf?: string;
}

const L = dim({ L: 1 }),
  M = dim({ M: 1 }),
  T = dim({ T: 1 });
const AREA = dim({ L: 2 }),
  VOL = dim({ L: 3 });
const FORCE = dim({ M: 1, L: 1, T: -2 });
const PRESS = dim({ M: 1, L: -1, T: -2 });
const ENERGY = dim({ M: 1, L: 2, T: -2 });
const POWER = dim({ M: 1, L: 2, T: -3 });
const VEL = dim({ L: 1, T: -1 });
const ACC = dim({ L: 1, T: -2 });
const ANG = dim({ A: 1 });

export const UNITS: UnitDef[] = [];
const byId = new Map<string, UnitDef>();
function u(def: Omit<UnitDef, 'aliases'> & { aliases?: string[] }): UnitDef {
  const full: UnitDef = { aliases: [], ...def };
  UNITS.push(full);
  byId.set(full.id, full);
  return full;
}

const PI = float(Math.PI);

// ── SI base & coherent derived ───────────────────────────────────────────────
u({ id: 'm', name: 'meter', dim: L, factor: D('1'), system: 'SI', prefixable: true, category: 'Length', base: true, commonPrefixes: ['k', 'c', 'm', 'µ', 'n'] });
u({ id: 'g', name: 'gram', dim: M, factor: D('0.001'), system: 'SI', prefixable: true, category: 'Mass', commonPrefixes: ['k', 'm', 'µ'] });
u({ id: 's', name: 'second', dim: T, factor: D('1'), system: 'SI', prefixable: true, category: 'Time', base: true, commonPrefixes: ['m', 'µ', 'n'], aliases: ['sec'] });
u({ id: 'A', name: 'ampere', dim: dim({ I: 1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', base: true, commonPrefixes: ['k', 'm', 'µ'] });
u({ id: 'K', name: 'kelvin', dim: dim({ K: 1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Temperature', base: true, commonPrefixes: ['m'] });
u({ id: 'mol', name: 'mole', dim: dim({ N: 1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Amount', base: true, commonPrefixes: ['k', 'm'] });
u({ id: 'cd', name: 'candela', dim: dim({ J: 1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Light', base: true });
u({ id: 'rad', name: 'radian', dim: ANG, factor: D('1'), system: 'SI', prefixable: true, category: 'Angle', base: true, commonPrefixes: ['m'] });

u({ id: 'N', name: 'newton', dim: FORCE, factor: D('1'), system: 'SI', prefixable: true, category: 'Force', coherentNamed: true, commonPrefixes: ['k', 'M', 'm', 'µ'] });
u({ id: 'Pa', name: 'pascal', dim: PRESS, factor: D('1'), system: 'SI', prefixable: true, category: 'Pressure', coherentNamed: true, commonPrefixes: ['k', 'M', 'G'] });
u({ id: 'J', name: 'joule', dim: ENERGY, factor: D('1'), system: 'SI', prefixable: true, category: 'Energy', coherentNamed: true, commonPrefixes: ['k', 'M', 'G', 'm'] });
u({ id: 'W', name: 'watt', dim: POWER, factor: D('1'), system: 'SI', prefixable: true, category: 'Power', coherentNamed: true, commonPrefixes: ['k', 'M', 'G', 'm'] });
u({ id: 'Hz', name: 'hertz', dim: dim({ T: -1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Frequency', commonPrefixes: ['k', 'M', 'G'] });
u({ id: 'C', name: 'coulomb', dim: dim({ I: 1, T: 1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['m', 'µ', 'n'] });
u({ id: 'V', name: 'volt', dim: dim({ M: 1, L: 2, T: -3, I: -1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['k', 'm', 'µ'] });
u({ id: 'Ω', name: 'ohm', dim: dim({ M: 1, L: 2, T: -3, I: -2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['k', 'M', 'm'], aliases: ['ohm', 'Ohm'] });
u({ id: 'S', name: 'siemens', dim: dim({ M: -1, L: -2, T: 3, I: 2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['m', 'µ'] });
u({ id: 'F', name: 'farad', dim: dim({ M: -1, L: -2, T: 4, I: 2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['m', 'µ', 'n', 'p'] });
u({ id: 'H', name: 'henry', dim: dim({ M: 1, L: 2, T: -2, I: -2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['m', 'µ', 'n'] });
u({ id: 'Wb', name: 'weber', dim: dim({ M: 1, L: 2, T: -2, I: -1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['m'] });
u({ id: 'T', name: 'tesla', dim: dim({ M: 1, T: -2, I: -1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', coherentNamed: true, commonPrefixes: ['m', 'µ'] });
u({ id: 'lm', name: 'lumen', dim: dim({ J: 1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Light' });
u({ id: 'lx', name: 'lux', dim: dim({ J: 1, L: -2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Light' });

// ── Length ───────────────────────────────────────────────────────────────────
u({ id: 'in', name: 'inch', dim: L, factor: D('0.0254'), system: 'US', category: 'Length', aliases: ['inch', 'inches'] });
u({ id: 'ft', name: 'foot', dim: L, factor: D('0.3048'), system: 'US', category: 'Length', aliases: ['feet', 'foot'] });
u({ id: 'yd', name: 'yard', dim: L, factor: D('0.9144'), system: 'US', category: 'Length' });
u({ id: 'mi', name: 'mile', dim: L, factor: D('1609.344'), system: 'US', category: 'Length', aliases: ['mile'] });
u({ id: 'nmi', name: 'nautical mile', dim: L, factor: D('1852'), system: 'other', category: 'Length' });
u({ id: 'mil', name: 'mil (thou)', dim: L, factor: D('0.0000254'), system: 'US', category: 'Length', aliases: ['thou'] });
u({ id: 'µin', name: 'microinch', dim: L, factor: D('0.0000000254'), system: 'US', category: 'Length', aliases: ['uin'] });
u({ id: 'Å', name: 'ångström', dim: L, factor: D('1e-10'), system: 'other', category: 'Length', aliases: ['angstrom'] });
u({ id: 'au', name: 'astronomical unit', dim: L, factor: D('149597870700'), system: 'SI-accepted', category: 'Length' });
u({ id: 'ly', name: 'light-year', dim: L, factor: D('9460730472580800'), system: 'other', category: 'Length' });
u({ id: 'pc', name: 'parsec', dim: L, factor: float(149597870700 * (648000 / Math.PI)), system: 'other', category: 'Length' });

// ── Area ─────────────────────────────────────────────────────────────────────
u({ id: 'ha', name: 'hectare', dim: AREA, factor: D('10000'), system: 'SI-accepted', category: 'Area' });
u({ id: 'acre', name: 'acre', dim: AREA, factor: D('4046.8564224'), system: 'US', category: 'Area', aliases: ['ac'] });
u({ id: 'cmil', name: 'circular mil', dim: AREA, factor: mul(powRational(D('0.0000254'), 2), div(PI, exact(4n))), system: 'US', category: 'Area' });

// ── Volume ───────────────────────────────────────────────────────────────────
u({ id: 'L', name: 'liter', dim: VOL, factor: D('0.001'), system: 'SI-accepted', prefixable: true, category: 'Volume', commonPrefixes: ['m'], aliases: ['l', 'liter', 'litre'] });
u({ id: 'cc', name: 'cubic centimeter', dim: VOL, factor: D('1e-6'), system: 'CGS', category: 'Volume' });
const GAL = mul(D('231'), powRational(D('0.0254'), 3));
u({ id: 'gal', name: 'US gallon', dim: VOL, factor: GAL, system: 'US', category: 'Volume', aliases: ['gallon'] });
u({ id: 'qt', name: 'US quart', dim: VOL, factor: div(GAL, exact(4n)), system: 'US', category: 'Volume' });
u({ id: 'pt', name: 'US pint', dim: VOL, factor: div(GAL, exact(8n)), system: 'US', category: 'Volume' });
u({ id: 'cup', name: 'US cup', dim: VOL, factor: div(GAL, exact(16n)), system: 'US', category: 'Volume' });
u({ id: 'floz', name: 'US fluid ounce', dim: VOL, factor: div(GAL, exact(128n)), system: 'US', category: 'Volume', aliases: ['fl_oz'] });
u({ id: 'tbsp', name: 'tablespoon', dim: VOL, factor: div(GAL, exact(256n)), system: 'US', category: 'Volume' });
u({ id: 'tsp', name: 'teaspoon', dim: VOL, factor: div(GAL, exact(768n)), system: 'US', category: 'Volume' });
u({ id: 'bbl', name: 'oil barrel', dim: VOL, factor: mul(GAL, exact(42n)), system: 'US', category: 'Volume' });
u({ id: 'gal_UK', name: 'imperial gallon', dim: VOL, factor: D('0.00454609'), system: 'UK', category: 'Volume', aliases: ['galUK'] });
u({ id: 'pt_UK', name: 'imperial pint', dim: VOL, factor: div(D('0.00454609'), exact(8n)), system: 'UK', category: 'Volume', aliases: ['ptUK'] });
u({ id: 'floz_UK', name: 'imperial fluid ounce', dim: VOL, factor: div(D('0.00454609'), exact(160n)), system: 'UK', category: 'Volume', aliases: ['flozUK'] });

// ── Mass ─────────────────────────────────────────────────────────────────────
const LBM = D('0.45359237');
u({ id: 't', name: 'metric ton', dim: M, factor: D('1000'), system: 'SI-accepted', category: 'Mass', aliases: ['tonne'] });
u({ id: 'lbm', name: 'pound-mass', dim: M, factor: LBM, system: 'US', category: 'Mass', aliases: ['lb', 'lbs'], ambiguous: ['lbm', 'lbf'] });
u({ id: 'oz', name: 'ounce', dim: M, factor: div(LBM, exact(16n)), system: 'US', category: 'Mass' });
u({ id: 'gr', name: 'grain', dim: M, factor: div(LBM, exact(7000n)), system: 'US', category: 'Mass' });
u({ id: 'slug', name: 'slug', dim: M, factor: div(mul(LBM, D('9.80665')), D('0.3048')), system: 'US', category: 'Mass' });
u({ id: 'ton', name: 'short ton', dim: M, factor: mul(LBM, exact(2000n)), system: 'US', category: 'Mass' });
u({ id: 'ton_UK', name: 'long ton', dim: M, factor: mul(LBM, exact(2240n)), system: 'UK', category: 'Mass', aliases: ['tonUK'] });
u({ id: 'Da', name: 'dalton', dim: M, factor: D('1.66053906892e-27'), system: 'SI-accepted', category: 'Mass', aliases: ['amu'] });

// ── Time ─────────────────────────────────────────────────────────────────────
u({ id: 'min', name: 'minute', dim: T, factor: D('60'), system: 'SI-accepted', category: 'Time' });
u({ id: 'h', name: 'hour', dim: T, factor: D('3600'), system: 'SI-accepted', category: 'Time', aliases: ['hr'] });
u({ id: 'd', name: 'day', dim: T, factor: D('86400'), system: 'SI-accepted', category: 'Time', aliases: ['day'] });
u({ id: 'wk', name: 'week', dim: T, factor: D('604800'), system: 'other', category: 'Time' });
u({ id: 'yr', name: 'year (Julian)', dim: T, factor: D('31557600'), system: 'other', category: 'Time', aliases: ['year'] });

// ── Force ────────────────────────────────────────────────────────────────────
const LBF = mul(LBM, D('9.80665'));
u({ id: 'lbf', name: 'pound-force', dim: FORCE, factor: LBF, system: 'US', category: 'Force' });
u({ id: 'kip', name: 'kip', dim: FORCE, factor: mul(LBF, exact(1000n)), system: 'US', category: 'Force' });
u({ id: 'ozf', name: 'ounce-force', dim: FORCE, factor: div(LBF, exact(16n)), system: 'US', category: 'Force' });
u({ id: 'kgf', name: 'kilogram-force', dim: FORCE, factor: D('9.80665'), system: 'other', category: 'Force' });
u({ id: 'tonf', name: 'short ton-force', dim: FORCE, factor: mul(LBF, exact(2000n)), system: 'US', category: 'Force' });
u({ id: 'pdl', name: 'poundal', dim: FORCE, factor: mul(LBM, D('0.3048')), system: 'UK', category: 'Force' });
u({ id: 'dyn', name: 'dyne', dim: FORCE, factor: D('1e-5'), system: 'CGS', category: 'Force' });

// ── Pressure ─────────────────────────────────────────────────────────────────
const IN2 = powRational(D('0.0254'), 2);
u({ id: 'bar', name: 'bar', dim: PRESS, factor: D('100000'), system: 'SI-accepted', prefixable: true, category: 'Pressure', commonPrefixes: ['m'] });
u({ id: 'atm', name: 'standard atmosphere', dim: PRESS, factor: D('101325'), system: 'other', category: 'Pressure' });
u({ id: 'psi', name: 'pound per square inch', dim: PRESS, factor: div(LBF, IN2), system: 'US', category: 'Pressure' });
u({ id: 'ksi', name: 'kip per square inch', dim: PRESS, factor: div(mul(LBF, exact(1000n)), IN2), system: 'US', category: 'Pressure' });
u({ id: 'psf', name: 'pound per square foot', dim: PRESS, factor: div(LBF, powRational(D('0.3048'), 2)), system: 'US', category: 'Pressure' });
u({ id: 'mmHg', name: 'millimeter of mercury', dim: PRESS, factor: D('133.322387415'), system: 'other', category: 'Pressure' });
u({ id: 'inHg', name: 'inch of mercury', dim: PRESS, factor: D('3386.389'), system: 'US', category: 'Pressure' });
u({ id: 'inH2O', name: 'inch of water', dim: PRESS, factor: D('249.08891'), system: 'US', category: 'Pressure' });
u({ id: 'Torr', name: 'torr', dim: PRESS, factor: div(D('101325'), exact(760n)), system: 'other', category: 'Pressure', aliases: ['torr'] });

// ── Energy ───────────────────────────────────────────────────────────────────
u({ id: 'Wh', name: 'watt-hour', dim: ENERGY, factor: D('3600'), system: 'SI-accepted', prefixable: true, category: 'Energy', commonPrefixes: ['k', 'M', 'G'] });
u({ id: 'cal', name: 'calorie (thermochemical)', dim: ENERGY, factor: D('4.184'), system: 'other', prefixable: true, category: 'Energy', commonPrefixes: ['k'] });
u({ id: 'BTU', name: 'British thermal unit (IT)', dim: ENERGY, factor: D('1055.05585262'), system: 'US', category: 'Energy', aliases: ['Btu', 'btu'] });
u({ id: 'thm', name: 'therm (US)', dim: ENERGY, factor: D('105480400'), system: 'US', category: 'Energy', aliases: ['therm'] });
u({ id: 'eV', name: 'electronvolt', dim: ENERGY, factor: D('1.602176634e-19'), system: 'SI-accepted', prefixable: true, category: 'Energy', commonPrefixes: ['k', 'M', 'G'] });
u({ id: 'erg', name: 'erg', dim: ENERGY, factor: D('1e-7'), system: 'CGS', category: 'Energy' });

// ── Power ────────────────────────────────────────────────────────────────────
u({ id: 'hp', name: 'horsepower (mechanical)', dim: POWER, factor: mul(D('550'), mul(D('0.3048'), LBF)), system: 'US', category: 'Power' });
u({ id: 'hp_M', name: 'metric horsepower', dim: POWER, factor: D('735.49875'), system: 'other', category: 'Power', aliases: ['PS'] });
u({ id: 'TR', name: 'ton of refrigeration', dim: POWER, factor: div(mul(D('12000'), D('1055.05585262')), D('3600')), system: 'US', category: 'Power' });

// ── Velocity ─────────────────────────────────────────────────────────────────
u({ id: 'mph', name: 'mile per hour', dim: VEL, factor: div(D('1609.344'), D('3600')), system: 'US', category: 'Velocity' });
u({ id: 'kn', name: 'knot', dim: VEL, factor: div(D('1852'), D('3600')), system: 'other', category: 'Velocity', aliases: ['knot', 'kt'] });

// ── Acceleration ─────────────────────────────────────────────────────────────
u({ id: 'Gal', name: 'gal (galileo)', dim: ACC, factor: D('0.01'), system: 'CGS', category: 'Acceleration' });

// ── Temperature ──────────────────────────────────────────────────────────────
u({ id: '°C', name: 'degree Celsius', dim: dim({ K: 1 }), factor: D('1'), offset: D('273.15'), tempKind: 'absolute', system: 'SI', category: 'Temperature', aliases: ['degC', 'C°'] });
u({ id: '°F', name: 'degree Fahrenheit', dim: dim({ K: 1 }), factor: div(exact(5n), exact(9n)), offset: mul(D('459.67'), div(exact(5n), exact(9n))), tempKind: 'absolute', system: 'US', category: 'Temperature', aliases: ['degF'] });
u({ id: '°R', name: 'degree Rankine', dim: dim({ K: 1 }), factor: div(exact(5n), exact(9n)), system: 'US', category: 'Temperature', aliases: ['degR'] });
u({ id: 'Δ°C', name: 'Celsius difference', dim: dim({ K: 1 }), factor: D('1'), tempKind: 'delta', system: 'SI', category: 'Temperature', aliases: ['ΔdegC', 'deltadegC'] });
u({ id: 'Δ°F', name: 'Fahrenheit difference', dim: dim({ K: 1 }), factor: div(exact(5n), exact(9n)), tempKind: 'delta', system: 'US', category: 'Temperature', aliases: ['ΔdegF', 'deltadegF'] });

// ── Angle ────────────────────────────────────────────────────────────────────
u({ id: '°', name: 'degree', dim: ANG, factor: div(PI, exact(180n)), system: 'SI-accepted', category: 'Angle', aliases: ['deg'] });
u({ id: '′', name: 'arcminute', dim: ANG, factor: div(PI, exact(10800n)), system: 'SI-accepted', category: 'Angle', aliases: ['arcmin'] });
u({ id: '″', name: 'arcsecond', dim: ANG, factor: div(PI, exact(648000n)), system: 'SI-accepted', category: 'Angle', aliases: ['arcsec'] });
u({ id: 'grad', name: 'gradian', dim: ANG, factor: div(PI, exact(200n)), system: 'other', category: 'Angle', aliases: ['gon'] });
u({ id: 'rev', name: 'revolution', dim: ANG, factor: mul(PI, exact(2n)), system: 'other', category: 'Angle', aliases: ['turn'] });

// ── Frequency / rotation ─────────────────────────────────────────────────────
u({ id: 'rpm', name: 'revolutions per minute', dim: dim({ A: 1, T: -1 }), factor: div(mul(PI, exact(2n)), exact(60n)), system: 'other', category: 'Angular velocity' });

// ── Electrical extras ────────────────────────────────────────────────────────
u({ id: 'Ah', name: 'ampere-hour', dim: dim({ I: 1, T: 1 }), factor: D('3600'), system: 'other', prefixable: true, category: 'Electrical', commonPrefixes: ['m'] });

// ── Flow ─────────────────────────────────────────────────────────────────────
u({ id: 'gpm', name: 'US gallon per minute', dim: dim({ L: 3, T: -1 }), factor: div(GAL, exact(60n)), system: 'US', category: 'Flow' });
u({ id: 'cfm', name: 'cubic foot per minute', dim: dim({ L: 3, T: -1 }), factor: div(powRational(D('0.3048'), 3), exact(60n)), system: 'US', category: 'Flow' });

// ── Viscosity ────────────────────────────────────────────────────────────────
u({ id: 'P', name: 'poise', dim: dim({ M: 1, L: -1, T: -1 }), factor: D('0.1'), system: 'CGS', prefixable: true, category: 'Viscosity', commonPrefixes: ['c'] });
u({ id: 'St', name: 'stokes', dim: dim({ L: 2, T: -1 }), factor: D('0.0001'), system: 'CGS', prefixable: true, category: 'Viscosity', commonPrefixes: ['c'] });

// ── Data ─────────────────────────────────────────────────────────────────────
u({ id: 'bit', name: 'bit', dim: dim({}), factor: D('1'), system: 'other', prefixable: true, category: 'Data', commonPrefixes: ['k', 'M', 'G'] });
u({ id: 'B', name: 'byte', dim: dim({}), factor: D('8'), system: 'other', prefixable: true, category: 'Data', commonPrefixes: ['k', 'M', 'G', 'T'] });

// ── Dimensionless ratios (display only) ──────────────────────────────────────
u({ id: '%', name: 'percent', dim: dim({}), factor: D('0.01'), system: 'other', category: 'Ratio' });
u({ id: '‰', name: 'per mille', dim: dim({}), factor: D('0.001'), system: 'other', category: 'Ratio', aliases: ['permille'] });
u({ id: 'ppm', name: 'parts per million', dim: dim({}), factor: D('1e-6'), system: 'other', category: 'Ratio' });
u({ id: 'µε', name: 'microstrain', dim: dim({}), factor: D('1e-6'), system: 'other', category: 'Ratio', aliases: ['ue', 'microstrain'] });

// ── Package-only units (DESIGN.md §7.1): off unless their package is enabled ──
u({ id: 'Gy', name: 'gray', dim: dim({ L: 2, T: -2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Radiation', commonPrefixes: ['m', 'µ'] });
u({ id: 'Sv', name: 'sievert', dim: dim({ L: 2, T: -2 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Radiation', commonPrefixes: ['m', 'µ'] });
u({ id: 'Bq', name: 'becquerel', dim: dim({ T: -1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Radiation', commonPrefixes: ['k', 'M', 'G'] });
u({ id: 'Ci', name: 'curie', dim: dim({ T: -1 }), factor: D('3.7e10'), system: 'other', prefixable: true, category: 'Radiation', commonPrefixes: ['m', 'µ'] });
u({ id: 'b', name: 'barn', dim: AREA, factor: D('1e-28'), system: 'other', prefixable: true, category: 'Area', commonPrefixes: ['m'], aliases: ['barn'] });
u({ id: 'Gs', name: 'gauss', dim: dim({ M: 1, T: -2, I: -1 }), factor: D('1e-4'), system: 'CGS', prefixable: true, category: 'Electrical', commonPrefixes: ['m'], aliases: ['gauss'] });
u({ id: 'VA', name: 'volt-ampere', dim: POWER, factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', commonPrefixes: ['k', 'M'] });
u({ id: 'VAr', name: 'volt-ampere reactive', dim: POWER, factor: D('1'), system: 'SI', prefixable: true, category: 'Electrical', commonPrefixes: ['k', 'M'], aliases: ['var_r'] });
u({ id: 'M', name: 'molar (mol/L)', dim: dim({ N: 1, L: -3 }), factor: D('1000'), system: 'SI-accepted', prefixable: true, category: 'Concentration', commonPrefixes: ['m', 'µ', 'n'], aliases: ['molar'] });
u({ id: 'kat', name: 'katal', dim: dim({ N: 1, T: -1 }), factor: D('1'), system: 'SI', prefixable: true, category: 'Catalytic activity', commonPrefixes: ['m', 'µ', 'n'] });

export const SI_PREFIXES: [string, Num][] = [
  ['Q', D('1e30')], ['R', D('1e27')], ['Y', D('1e24')], ['Z', D('1e21')], ['E', D('1e18')], ['P', D('1e15')],
  ['T', D('1e12')], ['G', D('1e9')], ['M', D('1e6')], ['k', D('1e3')], ['h', D('1e2')], ['da', D('1e1')],
  ['d', D('1e-1')], ['c', D('1e-2')], ['m', D('1e-3')], ['µ', D('1e-6')], ['n', D('1e-9')], ['p', D('1e-12')],
  ['f', D('1e-15')], ['a', D('1e-18')], ['z', D('1e-21')], ['y', D('1e-24')], ['r', D('1e-27')], ['q', D('1e-30')],
];
export const BINARY_PREFIXES: [string, Num][] = [
  ['Ki', D('1024')], ['Mi', D('1048576')], ['Gi', D('1073741824')], ['Ti', D('1099511627776')],
];

export const UNIT_BY_ID = byId;
