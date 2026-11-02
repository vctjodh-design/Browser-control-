// Entry point for the embedded match player (`sim.html`).
//
// The standalone game boots straight into its default clubs. Inside the match
// page the fixture owns the teams, so they arrive as query parameters and are
// applied to the shared TEAMS config before the engine builds the squads.
import { TEAMS } from './config.js';
import { labels } from './labels.js';

const params = new URLSearchParams(window.location.search);

function readColour(value, fallback) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec((value || '').trim());
  return match ? parseInt(match[1], 16) : fallback;
}

function scale(colour, factor) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = clamp((colour >> 16) & 255);
  const g = clamp((colour >> 8) & 255);
  const b = clamp(colour & 255);
  return (r << 16) | (g << 8) | b;
}

function luminance(colour) {
  return (((colour >> 16) & 255) * 0.299 + ((colour >> 8) & 255) * 0.587 + (colour & 255) * 0.114) / 255;
}

const css = (colour) => `#${colour.toString(16).padStart(6, '0')}`;

function configure(team, key, fallbackName, fallbackColour) {
  const primary = readColour(params.get(`${key}Colour`), fallbackColour);
  const trimmed = (params.get(key) ?? '').trim().replace(/\s+/g, ' ');
  const name = (trimmed || fallbackName).slice(0, 24).toUpperCase();

  team.name = name;
  team.short = (name.replace(/[^A-Z0-9]/g, '').slice(0, 3) || fallbackName.slice(0, 3)).padEnd(3, name[0] ?? 'X');
  team.primary = primary;
  team.secondary = scale(primary, 0.42);
  // Light kits get dark shorts so the two halves of the strip stay readable.
  team.shorts = luminance(primary) > 0.62 ? scale(primary, 0.35) : 0xffffff;
  team.socks = primary;
  team.accent = scale(primary, 1.28);
}

configure(TEAMS[0], 'home', TEAMS[0].name, TEAMS[0].primary);
configure(TEAMS[1], 'away', TEAMS[1].name, TEAMS[1].primary);

const setText = (selector, text) => {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
};

setText('.team.home .name', TEAMS[0].name);
setText('.team.away .name', TEAMS[1].name);
setText('.banner-inner p', `${TEAMS[0].name} v ${TEAMS[1].name}`);

document.querySelectorAll('.crest').forEach((crest, index) => {
  const team = TEAMS[index];
  if (!team) return;
  crest.style.setProperty('--c1', css(team.primary));
  crest.style.setProperty('--c2', css(team.secondary));
});

const venue = (params.get('venue') ?? '').trim().slice(0, 40);
labels.ledText = `${venue ? `${venue}  ·  ` : ''}${TEAMS[0].name}  ·  ${TEAMS[1].name}  ·  LIVE  `;

document.title = `${TEAMS[0].name} v ${TEAMS[1].name} — live simulation`;

// Imported after the config is patched: match.js reads TEAMS while it builds
// the squads.
await import('./main.js');
