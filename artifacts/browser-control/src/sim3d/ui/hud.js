export class HUD {
  constructor(match) {
    this.match = match;
    this.$ = (id) => document.getElementById(id);
    this.scoreHome = this.$('score-home');
    this.scoreAway = this.$('score-away');
    this.clock = this.$('match-clock');
    this.possHome = this.$('poss-home');
    this.possAway = this.$('poss-away');
    this.possHomePct = this.$('poss-home-pct');
    this.possAwayPct = this.$('poss-away-pct');
    this.ticker = this.$('ticker');
    this.banner = this.$('banner');
    this.goalOverlay = this.$('goal-overlay');
    this.goalSub = this.$('goal-sub');
    this.playerHint = this.$('player-hint');
    this.phName = this.$('ph-name');
    this.phStamina = this.$('ph-stamina');
    this.cardFlash = this.$('card-flash');
    this.cardChip = this.$('card-chip');
    this.cardFlashText = this.$('card-flash-text');
    this.cardsHome = this.$('cards-home');
    this.cardsAway = this.$('cards-away');
    this.tacticHome = this.$('tactic-home');
    this.tacticAway = this.$('tactic-away');
    this.tickTimer = 0;
    this.cardList = [[], []];
    this.statEls = {
      shots: [this.$('shots-home'), this.$('shots-away')],
      onTarget: [this.$('ontarget-home'), this.$('ontarget-away')],
      fouls: [this.$('fouls-home'), this.$('fouls-away')],
      corners: [this.$('corners-home'), this.$('corners-away')],
    };
  }

  bind({ onCamera, onSpeed, onHuman, onSound, onKickoff }) {
    document.querySelectorAll('[data-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cam]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        onCamera(btn.dataset.cam);
      });
    });
    document.querySelectorAll('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = parseFloat(btn.dataset.speed);
        this.setSpeed(value);
        onSpeed(value);
      });
    });
    this.$('toggle-facecam').addEventListener('click', (e) => {
      const on = e.currentTarget.classList.toggle('active');
      onHuman(on);
    });
    this.$('toggle-audio').addEventListener('click', (e) => {
      const on = e.currentTarget.classList.toggle('active');
      onSound(on);
    });
    this.$('kickoff-btn').addEventListener('click', onKickoff);
  }

  hideBanner() {
    this.banner.classList.add('hidden');
  }

  /** Light up the dock button matching a playback speed set from outside. */
  setSpeed(value) {
    const buttons = document.querySelectorAll('[data-speed]');
    let matched = false;
    buttons.forEach((b) => {
      const on = Math.abs(parseFloat(b.dataset.speed) - value) < 0.001;
      b.classList.toggle('active', on);
      if (on) matched = true;
    });
    if (!matched) buttons.forEach((b) => b.classList.remove('active'));
  }

  /** Wipe everything that belongs to a finished match before the next one. */
  reset() {
    this.cardList = [[], []];
    this.cardsHome.innerHTML = '';
    this.cardsAway.innerHTML = '';
    this.ticker.innerHTML = '';
    this.goalOverlay.classList.remove('show');
    this.cardFlash.classList.add('hidden');
  }

  setHumanMode(on) {
    this.playerHint.classList.toggle('hidden', !on);
    document.getElementById('toggle-facecam').classList.toggle('active', on);
  }

  addEvent(ev) {
    const div = document.createElement('div');
    div.className = 'tick' + (ev.team === 0 ? ' home' : ev.team === 1 ? ' away' : '');
    if (ev.type === 'yellow' || ev.type === 'red') {
      const chip = document.createElement('span');
      chip.className = `card-chip ${ev.type}`;
      chip.style.marginRight = '6px';
      chip.style.verticalAlign = '-1px';
      div.appendChild(chip);
      const span = document.createElement('span');
      span.textContent = ev.text;
      div.appendChild(span);
    } else {
      div.innerHTML = ev.html || ev.text;
    }
    this.ticker.prepend(div);
    while (this.ticker.children.length > 5) this.ticker.lastChild.remove();
    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 700);
    }, 7000);
  }

  showGoal({ team, scorer, number, score }) {
    const name = this.match.teams?.[team]?.name ?? '';
    this.goalSub.textContent = `No.${number} ${scorer} · ${name} · ${score[0]}–${score[1]}`;
    this.goalOverlay.classList.add('show');
    clearTimeout(this._goalTimer);
    this._goalTimer = setTimeout(() => this.goalOverlay.classList.remove('show'), 4200);
  }

  showCard({ color, player, number, team, reason }) {
    this.cardList[team].push(color);
    const holder = team === 0 ? this.cardsHome : this.cardsAway;
    holder.innerHTML = '';
    // reds first, then yellows, capped so the scoreboard stays readable
    const reds = this.cardList[team].filter((c) => c === 'red').length;
    const yellows = this.cardList[team].filter((c) => c === 'yellow').length;
    for (let i = 0; i < reds; i++) holder.appendChild(this.chip('red'));
    for (let i = 0; i < Math.min(yellows, 6); i++) holder.appendChild(this.chip('yellow'));

    this.cardChip.className = `card-chip ${color}`;
    this.cardFlashText.textContent = `${color === 'red' ? 'RED' : 'YELLOW'} CARD · No.${number} ${player}`;
    this.cardFlash.classList.remove('hidden');
    this.cardFlash.style.animation = 'none';
    void this.cardFlash.offsetWidth;
    this.cardFlash.style.animation = '';
    clearTimeout(this._cardTimer);
    this._cardTimer = setTimeout(() => this.cardFlash.classList.add('hidden'), 3200);
    this.addEvent({
      type: color,
      card: color,
      team,
      text: `${color === 'red' ? 'RED' : 'YELLOW'} · No.${number} ${player} — ${reason}`,
    });
  }

  chip(color) {
    const el = document.createElement('span');
    el.className = `card-chip ${color}`;
    return el;
  }

  update() {
    const m = this.match;
    this.scoreHome.textContent = m.score[0];
    this.scoreAway.textContent = m.score[1];
    this.clock.textContent = m.clockText();

    const [hp, ap] = m.possessionPct;
    this.possHome.style.width = `${hp}%`;
    this.possAway.style.width = `${ap}%`;
    this.possHomePct.textContent = hp;
    this.possAwayPct.textContent = ap;

    for (const [key, els] of Object.entries(this.statEls)) {
      els[0].textContent = Math.round(m.stats[0][key]);
      els[1].textContent = Math.round(m.stats[1][key]);
    }

    this.tacticHome.textContent = m.teams[0].tactics.label;
    this.tacticAway.textContent = m.teams[1].tactics.label;

    if (m.humanEnabled && m.human) {
      this.phName.textContent = `No.${m.human.number} ${m.human.name}`;
      this.phStamina.style.width = `${Math.round(m.human.stamina * 100)}%`;
    }
  }
}
