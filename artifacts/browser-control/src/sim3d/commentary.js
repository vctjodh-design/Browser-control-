// The commentator.
//
// The match already narrates itself in the ticker; this speaks the same match
// out loud through the browser's own speech synthesis, so there is no audio
// file to load and no service in the middle. Lines are written the way a
// commentator says them — short, in the moment, and about what just happened
// on the pitch — and they are throttled so the voice never talks over itself.
// It is deliberately on the events that matter (kick-off, goals, cards, saves,
// half and full time) rather than every pass: a wall of noise is not
// commentary.

const GOAL_LINES = [
  "Goal! {scorer} for {team} — it's {score}.",
  "That's in! {scorer} finds the net, {score}.",
  "{scorer} scores! {team} lead the moment, {score}.",
  "It's a goal for {team}! {scorer}, {score}.",
];

const SAVE_LINES = [
  "Big save! {team} keep it level at {score}.",
  "Denied! A fine stop and {team} survive.",
  "What a save — that looked certain.",
];

const SHOT_LINES = [
  "{player} has a go from distance.",
  "{player} lets fly — just wide.",
  "{player} shoots, blocked in the box.",
  "Chance here for {team}!",
];

const FOUL_LINES = [
  "That's a foul, and the referee has seen it.",
  "Free kick — the referee's not happy with that challenge.",
  "He's caught him late. Free kick.",
];

const HALF_LINES = [
  "That's the half-time whistle. {score}.",
  "Half time, and it's {score}.",
];

const FULL_LINES = [
  "Full time. {home} {homeGoals}, {away} {awayGoals}.",
  "It's all over — {home} {homeGoals}, {away} {awayGoals}.",
];

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

const fill = (line, data) =>
  line.replace(/\{(\w+)\}/g, (_, key) => (data[key] === undefined || data[key] === null ? "" : String(data[key])));

export class Commentary {
  constructor() {
    this.enabled = true;
    this.voice = null;
    this.lastSpokenAt = 0;
    this.supported = typeof window !== "undefined" && "speechSynthesis" in window;
    if (!this.supported) return;
    this.pickVoice();
    // Voices arrive asynchronously in most browsers; take the best one later.
    window.speechSynthesis.addEventListener?.("voiceschanged", () => this.pickVoice());
  }

  pickVoice() {
    if (!this.supported) return;
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
    const preferred = ["daniel", "google uk english male", "alex", "arthur", "oliver", "fred", "rishi", "male"];
    this.voice =
      voices.find((voice) => preferred.some((name) => voice.name.toLowerCase().includes(name))) ??
      voices.find((voice) => voice.lang?.toLowerCase().startsWith("en-gb")) ??
      voices[0] ??
      null;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) this.stop();
  }

  stop() {
    if (this.supported) window.speechSynthesis.cancel();
  }

  /**
   * Say one line. `urgent` is a goal or a whistle: it interrupts whatever is
   * being said. Everything else waits its turn and is dropped if the voice is
   * still busy, which is how a real commentary handles a crowded passage.
   */
  say(text, { urgent = false, gap = 1600 } = {}) {
    if (!this.supported || !this.enabled || !text) return;
    const synth = window.speechSynthesis;
    const now = performance.now();
    if (!urgent) {
      if (now - this.lastSpokenAt < gap) return;
      if (synth.speaking || synth.pending) return;
    } else {
      synth.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice?.lang ?? "en-GB";
    utterance.rate = 1.08;
    utterance.pitch = 0.9;
    utterance.volume = 0.95;
    synth.speak(utterance);
    this.lastSpokenAt = now;
  }

  scoreline(match) {
    return `${match.teams[0].name} ${match.score[0]}, ${match.teams[1].name} ${match.score[1]}`;
  }

  onKickoff(match) {
    this.say(`${match.teams[0].name} and ${match.teams[1].name} — we're under way.`, { urgent: true });
  }

  onEvent(event, match) {
    if (!event || !match) return;
    const team = event.team === 0 || event.team === 1 ? match.teams[event.team].name : "";
    const data = {
      player: event.player ?? "",
      team,
      score: this.scoreline(match),
      home: match.teams[0].name,
      away: match.teams[1].name,
      homeGoals: match.score[0],
      awayGoals: match.score[1],
    };

    switch (event.type) {
      case "halftime":
        this.say(fill(pick(HALF_LINES), data), { urgent: true });
        break;
      case "fulltime":
        this.say(fill(pick(FULL_LINES), data), { urgent: true });
        break;
      case "secondhalf":
        this.say("Second half under way.");
        break;
      case "shot":
        // The match already writes these lines and they carry the player's
        // name and what he did with it; a canned line would say less.
        this.say(
          event.text ? `${event.text}.` : fill(pick(event.onTarget ? SAVE_LINES : SHOT_LINES), data),
          { gap: 2600 },
        );
        break;
      case "penalty":
        this.say("Penalty! The referee points to the spot.", { urgent: true });
        break;
      case "yellow":
        this.say(`Yellow card for ${event.player ?? team}.`, { gap: 2200 });
        break;
      case "red":
        this.say(`${event.player ?? team} is sent off!`, { urgent: true });
        break;
      case "foul":
        this.say(fill(pick(FOUL_LINES), data), { gap: 11000 });
        break;
      default:
        break;
    }
  }

  onGoal(goal, match) {
    if (!goal || !match) return;
    const team = match.teams[goal.team === 0 || goal.team === 1 ? goal.team : 0].name;
    const line = fill(pick(GOAL_LINES), {
      scorer: goal.ownGoal ? `${goal.scorer} (own goal)` : goal.scorer ?? "the striker",
      team,
      score: `${match.teams[0].name} ${match.score[0]}, ${match.teams[1].name} ${match.score[1]}`,
    });
    this.say(`${line} ${goal.minute ? `${goal.minute} minutes gone.` : ""}`.trim(), { urgent: true });
  }

  onCard(card, match) {
    if (!card) return;
    const team = card.team === 0 || card.team === 1 ? match.teams[card.team].name : "";
    const red = card.color === "red";
    this.say(`${red ? "Red" : "Yellow"} card — ${card.player ?? team}.`, { urgent: red, gap: 2200 });
  }
}
