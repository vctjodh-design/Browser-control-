// Pitch dimensions in metres (FIFA standard)
export const PITCH = {
  length: 105,
  width: 68,
  halfLength: 52.5,
  halfWidth: 34,
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.1,
  penaltyDepth: 16.5,
  penaltyWidth: 40.32,
  sixDepth: 5.5,
  sixWidth: 18.32,
  penaltySpot: 11,
  centerCircle: 9.15,
  cornerRadius: 1,
};

export const TEAMS = [
  {
    id: 'home',
    name: 'NORTHGATE',
    short: 'NTH',
    primary: 0xc8122a,
    secondary: 0xffffff,
    shorts: 0xf2f4f8,
    socks: 0xc8122a,
    attackDir: 1, // +x
    accent: 0xff3b4d,
    formation: '4-3-3',
  },
  {
    id: 'away',
    name: 'RIVERMOUTH',
    short: 'RVM',
    primary: 0x1c4fd6,
    secondary: 0x0b1a3a,
    shorts: 0x101828,
    socks: 0x1c4fd6,
    attackDir: -1,
    accent: 0x4d84ff,
    formation: '4-4-2',
  },
];

// 4-3-3 in normalised own-half coordinates: x 0 = own goal line, 1 = opponent goal line
export const FORMATION_433 = [
  { role: 'GK', nx: 0.035, nz: 0.5 },
  { role: 'RB', nx: 0.26, nz: 0.86 },
  { role: 'CB', nx: 0.19, nz: 0.6 },
  { role: 'CB', nx: 0.19, nz: 0.4 },
  { role: 'LB', nx: 0.26, nz: 0.14 },
  { role: 'DM', nx: 0.36, nz: 0.5 },
  { role: 'CM', nx: 0.45, nz: 0.68 },
  { role: 'CM', nx: 0.45, nz: 0.32 },
  { role: 'RW', nx: 0.66, nz: 0.84 },
  { role: 'ST', nx: 0.72, nz: 0.5 },
  { role: 'LW', nx: 0.66, nz: 0.16 },
];

export const FORMATION_442 = [
  { role: 'GK', nx: 0.035, nz: 0.5 },
  { role: 'RB', nx: 0.26, nz: 0.86 },
  { role: 'CB', nx: 0.19, nz: 0.6 },
  { role: 'CB', nx: 0.19, nz: 0.4 },
  { role: 'LB', nx: 0.26, nz: 0.14 },
  { role: 'RM', nx: 0.44, nz: 0.87 },
  { role: 'CM', nx: 0.38, nz: 0.62 },
  { role: 'CM', nx: 0.38, nz: 0.38 },
  { role: 'LM', nx: 0.44, nz: 0.13 },
  { role: 'ST', nx: 0.68, nz: 0.57 },
  { role: 'ST', nx: 0.68, nz: 0.43 },
];

export const NAMES_HOME = [
  'V. KOVAC',
  'T. BRENNAN',
  'M. HALLAND',
  'R. OKAFOR',
  'D. FERREIRA',
  'S. LINDQVIST',
  'A. MORENO',
  'J. WHITTAKER',
  'K. DIABY',
  'L. MARSH',
  'N. SORENSEN',
];

export const NAMES_AWAY = [
  'P. ANDRADE',
  'C. WALKER',
  'B. NDIAYE',
  'E. KOVALENKO',
  'F. ROSSI',
  'G. ADEYEMI',
  'H. TANAKA',
  'I. PETROV',
  'J. BAUER',
  'K. MENDES',
  'L. DOYLE',
];
