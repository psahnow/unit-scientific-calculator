// Physical constants (CODATA 2022; exact where SI defines them).
import { parseDecimal as D, mul, div, float, type Num } from '../num';

export interface ConstDef {
  key: string; // normalized symbol, e.g. "g_0", "k_B", "ħ"
  latex: string; // how it is written inside \const{}
  name: string;
  value: Num; // value in `unit`
  unit: string; // parseable unit expression
}

const h = D('6.62607015e-34');
const NA = D('6.02214076e23');
const kB = D('1.380649e-23');

export const CONSTANTS: ConstDef[] = [
  { key: 'c', latex: 'c', name: 'speed of light', value: D('299792458'), unit: 'm/s' },
  { key: 'h', latex: 'h', name: 'Planck constant', value: h, unit: 'J*s' },
  { key: 'ħ', latex: '\\hbar', name: 'reduced Planck constant', value: div(h, float(2 * Math.PI)), unit: 'J*s' },
  { key: 'q_e', latex: 'q_{e}', name: 'elementary charge', value: D('1.602176634e-19'), unit: 'C' },
  { key: 'k_B', latex: 'k_{B}', name: 'Boltzmann constant', value: kB, unit: 'J/K' },
  { key: 'N_A', latex: 'N_{A}', name: 'Avogadro constant', value: NA, unit: '1/mol' },
  { key: 'R', latex: 'R', name: 'molar gas constant', value: mul(NA, kB), unit: 'J/(mol*K)' },
  { key: 'G', latex: 'G', name: 'gravitational constant', value: D('6.67430e-11'), unit: 'm^3/(kg*s^2)' },
  { key: 'g_0', latex: 'g_{0}', name: 'standard gravity', value: D('9.80665'), unit: 'm/s^2' },
  { key: 'ε_0', latex: '\\varepsilon_{0}', name: 'vacuum permittivity', value: D('8.8541878188e-12'), unit: 'F/m' },
  { key: 'µ_0', latex: '\\mu_{0}', name: 'vacuum permeability', value: D('1.25663706127e-6'), unit: 'N/A^2' },
  { key: 'σ_SB', latex: '\\sigma_{SB}', name: 'Stefan–Boltzmann constant', value: D('5.670374419e-8'), unit: 'W/(m^2*K^4)' },
  { key: 'm_e', latex: 'm_{e}', name: 'electron mass', value: D('9.1093837139e-31'), unit: 'kg' },
  { key: 'm_p', latex: 'm_{p}', name: 'proton mass', value: D('1.67262192595e-27'), unit: 'kg' },
  { key: 'm_n', latex: 'm_{n}', name: 'neutron mass', value: D('1.67492750056e-27'), unit: 'kg' },
  { key: 'a_0', latex: 'a_{0}', name: 'Bohr radius', value: D('5.29177210544e-11'), unit: 'm' },
  { key: 'P_atm', latex: 'P_{atm}', name: 'standard atmosphere', value: D('101325'), unit: 'Pa' },
  { key: 'R_air', latex: 'R_{air}', name: 'specific gas constant of dry air', value: D('287.05'), unit: 'J/(kg*K)' },
];

export const CONST_BY_KEY = new Map(CONSTANTS.map((c) => [c.key, c]));
