// Entry point for the embedded match player (`sim.html`).
//
// The standalone game boots straight into its default clubs. Inside the match
// page the fixture owns the teams, so they arrive as query parameters and are
// applied to the shared TEAMS config before the engine builds the squads.
import { TEAMS } from './config.js';
import { labels } from './labels.js';
import { recentForm, setFormProfile } from './sim/form-profile.js';

const params = new URLSearchParams(window.location.search);

// The match page reads each club's recent form, player ratings and predicted XI
// from the API and leaves the profile in session storage for this frame. It is
// optional: without it the game still runs its default squads.
function readFormProfile() {
  const fixture = (params.get('fixture') ?? '').trim();
  if (!/^\d+$/.test(fixture)) return null;
  try {
    const raw = window.sessionStorage.getItem(`sim-form-profile:${fixture}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const formProfile = setFormProfile(readFormProfile());

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

// With a form profile the crest line also carries the shape and the run of
// results the lineups were read from.
function teamTagline(index) {
  const team = formProfile?.teams?.[index];
  if (!team) return null;
  const form = recentForm(index, 5);
  return [team.formation, form].filter(Boolean).join(' · ');
}

const homeTag = teamTagline(0);
const awayTag = teamTagline(1);
setText(
  '.banner-inner p',
  homeTag || awayTag
    ? `${TEAMS[0].name} ${homeTag ?? ''}  v  ${TEAMS[1].name} ${awayTag ?? ''}`.replace(/\s+/g, ' ')
    : `${TEAMS[0].name} v ${TEAMS[1].name}`,
);

document.querySelectorAll('.crest').forEach((crest, index) => {
  const team = TEAMS[index];
  if (!team) return;
  crest.style.setProperty('--c1', css(team.primary));
  crest.style.setProperty('--c2', css(team.secondary));
});

const venue = (params.get('venue') ?? '').trim().slice(0, 40);
labels.ledText = `${venue ? `${venue}  ·  ` : ''}${TEAMS[0].name}  ·  ${TEAMS[1].name}  ·  LIVE  `;

document.title = `${TEAMS[0].name} v ${TEAMS[1].name} — live simulation`;

// The optional replay: this fixture, played by the Open Football engine rather
// than invented here. It arrives already recorded, so all that is left is for
// the pitch to walk through it.
if ((params.get('engine') ?? '').trim() === 'open-football') {
  const fixture = (params.get('fixture') ?? '').trim();
  const seed = (params.get('seed') ?? '7').trim();
  if (/^\d+$/.test(fixture)) {
    const banner = document.getElementById('banner');
    const note = banner?.querySelector('.banner-hint');
    if (note) note.textContent = 'Playing this fixture with the Open Football engine…';
    try {
      const response = await fetch(
        `/api/football/matches/${fixture}/open-football-replay?seed=${encodeURIComponent(seed)}`,
      );
      if (response.ok) {
        window.__openFootballReplay = await response.json();
      } else {
        const body = await response.json().catch(() => ({}));
        window.__openFootballError = body.error || `the engine returned ${response.status}`;
      }
    } catch (error) {
      window.__openFootballError = 'the engine could not be reached';
    }
    if (window.__openFootballError) {
      console.warn('Open Football replay unavailable:', window.__openFootballError);
      if (note) note.textContent = 'Engine unavailable — playing the house simulation instead.';
    }
  }
}

// Imported after the config is patched: match.js reads TEAMS while it builds
// the squads.
await import('./main.js');
