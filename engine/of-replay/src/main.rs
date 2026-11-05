//! One Open Football match, played headlessly, written out as the movement our
//! 3D viewer replays.
//!
//! Input (stdin, JSON): two elevens plus a seed.
//! Output (stdout, JSON): the score, the goals, every substitution, and the
//! sampled position of each player and the ball.

use core::club::player::PlayerPositionType;
use core::club::team::tactics::{MatchTacticType, Tactics};
use core::r#match::player::MatchPlayer;
use core::r#match::{FootballEngine, MatchSquad};
use core::{AcademyGenerationContext, MatchRuntime, PeopleNameGeneratorData, PlayerGenerator};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{Read, Write};

/// The engine's pitch: an 840 x 545 grid of 0.125 m units, origin in a corner.
const UNITS_TO_METRES: f32 = 0.125;
const FIELD_UNITS_X: f32 = 840.0;
const FIELD_UNITS_Y: f32 = 545.0;

/// One sample per 200 ms is enough for playback: the viewer interpolates, and
/// the full 10 ms recording of a 90-minute match is a quarter of a gigabyte.
const SAMPLE_EVERY_MS: u64 = 400;

#[derive(Deserialize)]
struct MatchSpec {
    #[serde(default)]
    seed: u64,
    home: TeamSpec,
    away: TeamSpec,
}

#[derive(Deserialize)]
struct TeamSpec {
    name: String,
    #[serde(default)]
    tactic: Option<String>,
    /// Shirt colour for the broadcast viewer's scoreboard and kit.
    #[serde(default)]
    color: Option<String>,
    players: Vec<PlayerSpec>,
    #[serde(default)]
    bench: Vec<PlayerSpec>,
}

#[derive(Deserialize)]
struct PlayerSpec {
    name: String,
    /// Engine role, e.g. `Goalkeeper`, `DefenderCenterLeft`, `Striker`.
    #[serde(default)]
    position: Option<String>,
    /// 1..20, the scale the generator and the engine's skills share.
    #[serde(default = "default_level")]
    level: u8,
    #[serde(default)]
    shirt: Option<u8>,
}

fn default_level() -> u8 {
    12
}

fn position_of(spec: &PlayerSpec, fallback: PlayerPositionType) -> PlayerPositionType {
    match spec.position.as_deref() {
        Some(name) => parse_position(name).unwrap_or(fallback),
        None => fallback,
    }
}

fn parse_position(name: &str) -> Option<PlayerPositionType> {
    let key: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    PlayerPositionType::ALL.into_iter().find(|pos| {
        let candidate: String = pos
            .to_string()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        candidate == key
    })
}

fn tactic_of(name: Option<&str>) -> Tactics {
    let key = name.unwrap_or("T442").to_ascii_uppercase();
    let tactic = match key.as_str() {
        "T433" | "433" => MatchTacticType::T433,
        "T4231" | "4231" => MatchTacticType::T4231,
        "T352" | "352" => MatchTacticType::T352,
        "T451" | "451" => MatchTacticType::T451,
        _ => MatchTacticType::T442,
    };
    Tactics::new(tactic)
}

/// The harness's invented footballer: the engine's own generator at the given
/// level, renamed to the real player, so a squad reads like the fixture it is
/// standing in for.
fn generate_player(id: u32, position: PlayerPositionType, level: u8, name: &str) -> core::Player {
    let empty_names = PeopleNameGeneratorData {
        first_names: Vec::new(),
        last_names: Vec::new(),
        nicknames: Vec::new(),
    };
    let now = core::staff_contract_mod::NaiveDate::from_ymd_opt(2026, 11, 4).unwrap();
    let mut player = PlayerGenerator::generate_with_context(
        1,
        "",
        now,
        position,
        &empty_names,
        &AcademyGenerationContext::average(),
        24,
        30,
        None,
    );

    // Level → the mean skill the engine's own calibration harness uses:
    // level 1 is Sunday League, level 20 is Champions League elite.
    let target = 3.6 + level.clamp(1, 20) as f32 * 0.575;
    let current = mean_skills(&player.skills);
    let delta = target - current;
    player.skills.shift(delta, delta);

    player.id = id;
    let (first, last) = split_name(name);
    player.full_name = core::shared::fullname::FullName::new(first, last);
    player
}

fn mean_skills(skills: &core::PlayerSkills) -> f32 {
    let t = &skills.technical;
    let m = &skills.mental;
    let p = &skills.physical;
    let g = &skills.goalkeeping;
    let total = t.corners
        + t.crossing
        + t.dribbling
        + t.finishing
        + t.first_touch
        + t.free_kicks
        + t.heading
        + t.long_shots
        + t.long_throws
        + t.marking
        + t.passing
        + t.penalty_taking
        + t.tackling
        + t.technique
        + m.aggression
        + m.anticipation
        + m.bravery
        + m.composure
        + m.concentration
        + m.decisions
        + m.determination
        + m.flair
        + m.leadership
        + m.off_the_ball
        + m.positioning
        + m.teamwork
        + m.vision
        + m.work_rate
        + p.acceleration
        + p.agility
        + p.balance
        + p.jumping
        + p.natural_fitness
        + p.pace
        + p.stamina
        + p.strength
        + g.aerial_reach
        + g.command_of_area
        + g.communication
        + g.eccentricity
        + g.first_touch
        + g.handling
        + g.kicking
        + g.one_on_ones
        + g.passing
        + g.punching
        + g.reflexes
        + g.rushing_out
        + g.throwing;
    total / 49.0
}

fn split_name(name: &str) -> (String, String) {
    match name.rsplit_once(' ') {
        Some((first, last)) => (first.to_string(), last.to_string()),
        None => (name.to_string(), String::new()),
    }
}

struct BuiltTeam {
    squad: MatchSquad,
    /// id → (name, role, shirt, is_substitute)
    roster: Vec<Value>,
}

fn build_team(spec: &TeamSpec, team_id: u32, fallback_roles: &[PlayerPositionType]) -> BuiltTeam {
    let base_id = team_id * 1000;
    let mut roster = Vec::new();

    let mut build = |spec: &PlayerSpec, index: usize, team_id: u32, is_sub: bool| {
        let fallback = fallback_roles
            .get(index)
            .copied()
            .unwrap_or(PlayerPositionType::MidfielderCenter);
        let role = position_of(spec, fallback);
        let id = base_id + index as u32;
        let player = generate_player(id, role, spec.level, &spec.name);
        let match_player = MatchPlayer::from_player(team_id, &player, role, false, None);
        roster.push(json!({
            "id": match_player.id,
            "name": spec.name,
            "role": role.to_string(),
            "shirt": spec.shirt.unwrap_or((index + 1) as u8),
            "sub": is_sub,
        }));
        match_player
    };

    let main_squad: Vec<MatchPlayer> = spec
        .players
        .iter()
        .enumerate()
        .map(|(index, player)| build(player, index, team_id, false))
        .collect();

    let mut substitutes: Vec<MatchPlayer> = Vec::new();
    for (offset, player) in spec.bench.iter().enumerate() {
        let index = spec.players.len() + offset;
        substitutes.push(build(player, index, team_id, true));
    }

    BuiltTeam {
        squad: MatchSquad {
            team_id,
            team_name: spec.name.clone(),
            tactics: tactic_of(spec.tactic.as_deref()),
            main_squad,
            substitutes,
            captain_id: None,
            vice_captain_id: None,
            penalty_taker_id: None,
            free_kick_taker_id: None,
            selection_omissions: Vec::new(),
            overlooked: Vec::new(),
            coach_snapshot: None,
        },
        roster,
    }
}

/// A whole recording as `[t, x, y, z]` quads in metres, sampled coarsely.
fn track(item: impl Iterator<Item = (u64, [f32; 3])>, every_ms: u64) -> Value {
    let mut last = u64::MAX;
    let mut out: Vec<Vec<i32>> = Vec::new();
    for (timestamp, coords) in item {
        if last != u64::MAX && timestamp.saturating_sub(last) < every_ms {
            continue;
        }
        last = timestamp;
        let x = coords[0] * UNITS_TO_METRES;
        let y = coords[1] * UNITS_TO_METRES;
        // Centimetres, so the JSON stays compact and the viewer gets 1 cm
        // precision — far finer than anything visible at pitch scale.
        out.push(vec![
            timestamp as i32,
            (x * 100.0).round() as i32,
            (y * 100.0).round() as i32,
            (coords[2] * 100.0).round() as i32,
        ]);
    }
    Value::Array(out.into_iter().map(|q| json!(q)).collect())
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("no spec on stdin");
    let spec: MatchSpec = serde_json::from_str(&input).expect("spec is not valid json");

    MatchRuntime::set_events_mode(true);

    let home = build_team(&spec.home, 1, &DEFAULT_442);
    let away = build_team(&spec.away, 2, &DEFAULT_442);

    let started = std::time::Instant::now();
    let result = FootballEngine::<840, 545>::play_seeded(
        home.squad,
        away.squad,
        true,  // record the match
        false, // not a friendly
        false, // not a knockout
        Some(spec.seed),
    );
    let elapsed = started.elapsed();

    let score = result.score.as_ref();
    let home_goals = score.map(|s| s.home_team.get()).unwrap_or(0);
    let away_goals = score.map(|s| s.away_team.get()).unwrap_or(0);

    let mut players = std::collections::BTreeMap::new();
    for entry in home.roster.iter().chain(away.roster.iter()) {
        let id = entry["id"].as_u64().unwrap();
        players.insert(id.to_string(), entry.clone());
    }

    let mut tracks = serde_json::Map::new();
    for id in result.position_data.get_player_ids() {
        if let Some(samples) = result.position_data.player_track(id) {
            let track = track(
                samples.iter().map(|s| (s.timestamp, s.coords())),
                SAMPLE_EVERY_MS,
            );
            tracks.insert(id.to_string(), track);
        }
    }

    let ball = track(
        result
            .position_data
            .ball_track()
            .iter()
            .map(|s| (s.timestamp, s.coords())),
        SAMPLE_EVERY_MS / 2,
    );

    let substitutions: Vec<Value> = result
        .substitutions
        .iter()
        .map(|change| {
            json!({
                "t": change.match_time_ms,
                "team": change.team_id,
                "out": change.player_out_id,
                "in": change.player_in_id,
            })
        })
        .collect();

    let goals: Vec<Value> = score
        .map(|s| {
            s.details
                .iter()
                .map(|goal| json!(goal))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    // Per-side totals, summed over everyone who played. Possession is not a
    // figure the engine emits, so it is read off the share of passes attempted
    // — which is what possession is, measured by the team that had the ball.
    let mut side_stats = [
        json!({ "shots": 0, "onTarget": 0, "passes": 0, "possession": 50 }),
        json!({ "shots": 0, "onTarget": 0, "passes": 0, "possession": 50 }),
    ];
    let mut totals = [[0u32; 3]; 2];
    for (id, line) in &result.player_stats {
        let side = if *id / 1000 == 1 { 0 } else { 1 };
        totals[side][0] += line.shots_total as u32;
        totals[side][1] += line.shots_on_target as u32;
        totals[side][2] += line.passes_attempted as u32;
    }
    let passes = totals[0][2] + totals[1][2];
    for side in 0..2 {
        let share = if passes > 0 {
            (totals[side][2] as f32 / passes as f32 * 100.0).round() as u32
        } else {
            50
        };
        side_stats[side] = json!({
            "shots": totals[side][0],
            "onTarget": totals[side][1],
            "passes": totals[side][2],
            "possession": share,
        });
    }

    // `--viewer <dir>`: the same match, written in the shape the upstream Bevy
    // viewer reads — gzipped position chunks, their metadata document and the
    // fixture the page hands the canvas. That viewer is the engine's own
    // broadcast renderer (stadium, crowd, kits, scoreboard), so this is what
    // lets the app show their match rather than an approximation of it.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--viewer") {
        let dir = std::path::PathBuf::from(
            args.get(2).cloned().unwrap_or_else(|| "viewer".to_string()),
        );
        std::fs::create_dir_all(&dir).expect("viewer directory");

        // Upstream cuts the recording into five-minute chunks.
        const CHUNK_MS: u64 = 300_000;
        let chunks = result.position_data.split_into_chunks(CHUNK_MS);
        for (index, chunk) in chunks.iter().enumerate() {
            let raw = serde_json::to_vec(chunk).expect("chunk json");
            let file = std::fs::File::create(dir.join(format!("chunk_{index}.json.gz")))
                .expect("chunk file");
            let mut encoder =
                flate2::write::GzEncoder::new(file, flate2::Compression::default());
            encoder.write_all(&raw).expect("chunk gzip");
            encoder.finish().expect("chunk gzip finish");
        }

        let metadata = json!({
            "chunk_count": chunks.len(),
            "chunk_duration_ms": CHUNK_MS,
            "total_duration_ms": result.position_data.max_timestamp(),
        });
        std::fs::write(dir.join("metadata.json"), serde_json::to_vec(&metadata).unwrap())
            .expect("metadata");

        // One entry per man, in the order the viewer builds its squad. The
        // look is three indices into the engine's own colour tables, kept in
        // range by construction.
        let player_json = |entry: &Value, is_home: bool| -> Value {
            let id = entry["id"].as_u64().unwrap_or(0) as u32;
            let (first, last) = split_name(entry["name"].as_str().unwrap_or(""));
            let position = entry["role"]
                .as_str()
                .and_then(parse_position)
                .map(|pos| pos.get_short_name())
                .unwrap_or("MC");
            json!({
                "id": id,
                "shirt_number": entry["shirt"].as_u64().unwrap_or(1) as u8,
                "first_name": first,
                "last_name": last,
                "position": position,
                "is_home": is_home,
                "starting": !entry["sub"].as_bool().unwrap_or(false),
                "skin": (id % 12) as u8,
                "hair": ((id / 2) % 10) as u8,
                "eyes": (id % 8) as u8,
            })
        };

        let mut players = Vec::new();
        for entry in home.roster.iter() {
            players.push(player_json(entry, true));
        }
        for entry in away.roster.iter() {
            players.push(player_json(entry, false));
        }

        let goals_json: Vec<Value> = score
            .map(|s| {
                s.details
                    .iter()
                    .filter(|goal| {
                        goal.stat_type
                            == core::r#match::player::statistics::MatchStatisticType::Goal
                    })
                    .map(|goal| {
                        json!({
                            "player_id": goal.player_id,
                            "time": goal.time,
                            "is_auto_goal": goal.is_auto_goal,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let chances_json: Vec<Value> = result
            .chances
            .iter()
            .map(|chance| json!({ "player_id": chance.player_id, "time": chance.time }))
            .collect();

        let viewer_subs: Vec<Value> = result
            .substitutions
            .iter()
            .map(|change| {
                json!({
                    "player_in_id": change.player_in_id,
                    "player_out_id": change.player_out_id,
                    "time": change.match_time_ms,
                    "break_ms": change.break_ms,
                })
            })
            .collect();

        let config = json!({
            "match_time_ms": result.match_time_ms,
            "home_name": spec.home.name,
            "away_name": spec.away.name,
            "home": {
                "background": spec.home.color.clone().unwrap_or_else(|| "#00307d".to_string()),
                "foreground": "#ffffff",
            },
            "away": {
                "background": spec.away.color.clone().unwrap_or_else(|| "#b33f00".to_string()),
                "foreground": "#ffffff",
            },
            "home_goals": home_goals,
            "away_goals": away_goals,
            "players": players,
            "goals": goals_json,
            "chances": chances_json,
            "substitutions": viewer_subs,
            "venue": {
                "field_style": 5,
                "capacity": 62_000,
                "attendance": 54_000,
                "reputation": 9_400,
                "visitor": 9_200,
                "youth": false,
            },
            "debug": false,
            "lineup": true,
        });
        std::fs::write(dir.join("config.json"), serde_json::to_vec(&config).unwrap())
            .expect("config");

        println!(
            "{}",
            json!({ "dir": dir.to_string_lossy(), "chunks": chunks.len(), "players": players.len() })
        );
        return;
    }

    let out = json!({
        "engine": "open-football",
        "engineVersion": "1.8.183",
        "stats": { "home": side_stats[0], "away": side_stats[1] },
        "seed": spec.seed,
        "pitch": {
            "lengthM": FIELD_UNITS_X * UNITS_TO_METRES,
            "widthM": FIELD_UNITS_Y * UNITS_TO_METRES,
        },
        "score": { "home": home_goals, "away": away_goals },
        "teams": {
            "home": spec.home.name,
            "away": spec.away.name,
        },
        "durationMs": result.match_time_ms,
        "players": players,
        "substitutions": substitutions,
        "goals": goals,
        "ball": ball,
        "tracks": tracks,
        "sampleEveryMs": SAMPLE_EVERY_MS,
        "engineMs": elapsed.as_millis() as u64,
    });

    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    serde_json::to_writer(&mut handle, &out).expect("failed to write json");
    handle.flush().ok();
}

/// The 4-4-2 a squad falls back to when a player carries no role of his own.
const DEFAULT_442: [PlayerPositionType; 11] = [
    PlayerPositionType::Goalkeeper,
    PlayerPositionType::DefenderLeft,
    PlayerPositionType::DefenderCenterLeft,
    PlayerPositionType::DefenderCenterRight,
    PlayerPositionType::DefenderRight,
    PlayerPositionType::MidfielderLeft,
    PlayerPositionType::MidfielderCenterLeft,
    PlayerPositionType::MidfielderCenterRight,
    PlayerPositionType::MidfielderRight,
    PlayerPositionType::ForwardLeft,
    PlayerPositionType::ForwardRight,
];
