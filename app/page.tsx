"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

type Screen = "home" | "lobby" | "game" | "results";
type Player = { id: string; name: string; x: number; y: number; color: string; isIt: boolean; score: number };
type GameState = { status: "playing" | "finished"; players: Player[]; startedAt: number; endsAt: number };
type Presence = { id: string; name: string; color: string };

const COLORS = ["#ff3f88", "#3d8bff", "#18c981", "#ffb62e", "#9b6cff", "#ff5d4d", "#16b8c8", "#ef6fc1"];
const GAME_SECONDS = 120;
const SPEED = 0.75;
const TAG_DISTANCE = 6.5;

function makeCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function supabaseFromEnv(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? createClient(url, key) : null;
}

export default function Home() {
  const supabase = useMemo(supabaseFromEnv, []);
  const [screen, setScreen] = useState<Screen>("home");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(GAME_SECONDS);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const idRef = useRef<string>("");
  const inputRef = useRef({ up: false, down: false, left: false, right: false });
  const gameRef = useRef<GameState | null>(null);
  const hostLoopRef = useRef<number | null>(null);

  useEffect(() => {
    idRef.current = crypto.randomUUID();
    const savedName = localStorage.getItem("tag-arena-name");
    if (savedName) setName(savedName);
    const savedSound = localStorage.getItem("tag-arena-sound");
    if (savedSound) setSoundOn(savedSound === "on");
  }, []);

  useEffect(() => {
    gameRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent, value: boolean) => {
      if (screen !== "game") return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
      if (key === "w" || key === "arrowup") inputRef.current.up = value;
      if (key === "s" || key === "arrowdown") inputRef.current.down = value;
      if (key === "a" || key === "arrowleft") inputRef.current.left = value;
      if (key === "d" || key === "arrowright") inputRef.current.right = value;
    };
    const down = (e: KeyboardEvent) => onKey(e, true);
    const up = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [screen]);

  useEffect(() => {
    return () => {
      if (hostLoopRef.current) cancelAnimationFrame(hostLoopRef.current);
      channelRef.current?.unsubscribe();
    };
  }, []);

  const persistName = (value: string) => {
    setName(value);
    localStorage.setItem("tag-arena-name", value);
  };

  async function connectToRoom(code: string, host: boolean) {
    setError("");
    if (!supabase) {
      setError("Multiplayer is not configured yet. Add the Supabase environment variables to start online play.");
      return;
    }
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim().slice(0, 16);
    if (!cleanName) { setError("Enter a nickname first."); return; }
    if (cleanCode.length < 4) { setError("Enter a valid room code."); return; }

    channelRef.current?.unsubscribe();
    const channel = supabase.channel(`tag-room-${cleanCode}`, { config: { presence: { key: idRef.current } } });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Presence>();
      const next = Object.values(state).flat().map((p) => ({ id: p.id, name: p.name, color: p.color }));
      setPlayers((current) => next.map((p) => current.find((x) => x.id === p.id) ?? ({ ...p, x: 50, y: 50, isIt: false, score: 0 })));
    });
    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      setGameState(payload.state);
      setScreen("game");
    });
    channel.on("broadcast", { event: "game-state" }, ({ payload }) => {
      setGameState(payload.state);
      setPlayers(payload.state.players);
      if (payload.state.status === "finished") setScreen("results");
    });
    channel.on("broadcast", { event: "game-stop" }, () => setScreen("lobby"));

    await channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      setConnected(true);
      setIsHost(host);
      await channel.track({ id: idRef.current, name: cleanName, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
      setRoomCode(cleanCode);
      setScreen("lobby");
    });
  }

  async function createRoom() {
    const code = makeCode();
    await connectToRoom(code, true);
  }

  async function joinRoom() {
    await connectToRoom(roomCode, false);
  }

  function startGame() {
    if (!channelRef.current || !isHost || players.length < 2) return;
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const now = Date.now();
    const initial: GameState = {
      status: "playing",
      startedAt: now,
      endsAt: now + GAME_SECONDS * 1000,
      players: shuffled.map((p, index) => ({ ...p, x: 15 + Math.random() * 70, y: 18 + Math.random() * 64, isIt: index === 0, score: 0 })),
    };
    gameRef.current = initial;
    setGameState(initial);
    setPlayers(initial.players);
    setScreen("game");
    channelRef.current.send({ type: "broadcast", event: "game-start", payload: { state: initial } });
    runHostLoop();
  }

  function runHostLoop() {
    if (!channelRef.current) return;
    const tick = () => {
      const state = gameRef.current;
      if (!state || state.status !== "playing") return;
      const me = state.players.find((p) => p.id === idRef.current);
      const nextPlayers = state.players.map((p) => {
        if (p.id !== idRef.current) return p;
        const i = inputRef.current;
        const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
        const dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
        const len = Math.hypot(dx, dy) || 1;
        return { ...p, x: clamp(p.x + (dx / len) * SPEED, 5, 95), y: clamp(p.y + (dy / len) * SPEED, 8, 92) };
      });
      // Host applies its own input and also accepts remote input packets.
      const now = Date.now();
      let updated = { ...state, players: nextPlayers };
      if (now >= state.endsAt) updated = { ...updated, status: "finished" };
      const it = updated.players.find((p) => p.isIt);
      if (it) {
        const victim = updated.players.find((p) => p.id !== it.id && Math.hypot(p.x - it.x, p.y - it.y) < TAG_DISTANCE);
        if (victim) {
          updated = {
            ...updated,
            players: updated.players.map((p) => p.id === it.id ? { ...p, isIt: false } : p.id === victim.id ? { ...p, isIt: true, score: p.score + 1 } : p),
          };
        }
      }
      gameRef.current = updated;
      setGameState(updated);
      setPlayers(updated.players);
      channelRef.current?.send({ type: "broadcast", event: "game-state", payload: { state: updated } });
      if (updated.status === "finished") { setScreen("results"); return; }
      hostLoopRef.current = requestAnimationFrame(tick);
    };
    hostLoopRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    if (screen !== "game" || !channelRef.current || isHost) return;
    const interval = window.setInterval(() => {
      channelRef.current?.send({ type: "broadcast", event: "input", payload: { id: idRef.current, input: inputRef.current } });
    }, 50);
    const inputHandler = channelRef.current.on("broadcast", { event: "input" }, ({ payload }) => {
      if (!isHost || !gameRef.current) return;
      const state = gameRef.current;
      const p = state.players.find((x) => x.id === payload.id);
      if (!p) return;
      const i = payload.input as typeof inputRef.current;
      const dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
      const dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      const next = { ...p, x: clamp(p.x + (dx / len) * SPEED, 5, 95), y: clamp(p.y + (dy / len) * SPEED, 8, 92) };
      gameRef.current = { ...state, players: state.players.map((x) => x.id === p.id ? next : x) };
    });
    return () => { window.clearInterval(interval); void inputHandler; };
  }, [screen, isHost]);

  useEffect(() => {
    if (screen !== "game" || !gameState) return;
    const interval = window.setInterval(() => setSecondsLeft(Math.max(0, Math.ceil((gameState.endsAt - Date.now()) / 1000))), 250);
    return () => window.clearInterval(interval);
  }, [screen, gameState]);

  async function playAgain() {
    setScreen("lobby");
    setGameState(null);
    if (isHost) await channelRef.current?.send({ type: "broadcast", event: "game-stop", payload: {} });
  }

  function leaveRoom() {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setConnected(false);
    setIsHost(false);
    setPlayers([]);
    setGameState(null);
    setRoomCode("");
    setScreen("home");
  }

  const myPlayer = gameState?.players.find((p) => p.id === idRef.current);
  const envReady = Boolean(supabase);

  return (
    <main className="app-shell">
      <div className="sky-glow" />
      <header className="topbar">
        <button className="brand" onClick={() => screen === "home" ? null : leaveRoom()} aria-label="Tag Arena home">
          <span className="brand-tag">TAG</span><span className="brand-arena">ARENA</span>
        </button>
        <div className="top-actions">
          {connected && <span className="connection"><i /> ONLINE</span>}
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙</button>
        </div>
      </header>

      {screen === "home" && (
        <section className="home-screen">
          <div className="hero-copy">
            <p className="eyebrow">REAL-TIME • FRIENDS • CHAOS</p>
            <h1>TAG<br /><span>ARENA</span></h1>
            <p className="subtitle">Run. Dodge. Tag your friends.<br />Last one standing gets bragging rights.</p>
          </div>
          <div className="home-card">
            <label>YOUR NICKNAME</label>
            <input value={name} maxLength={16} onChange={(e) => persistName(e.target.value)} placeholder="Enter your name" />
            <button className="primary-btn pink" onClick={createRoom}>CREATE ROOM <span>→</span></button>
            <div className="or"><span /> OR <span /></div>
            <div className="join-row">
              <input value={roomCode} maxLength={5} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" />
              <button className="primary-btn blue" onClick={joinRoom}>JOIN</button>
            </div>
            <p className="tiny">Share the room code with your friends.</p>
          </div>
          <div className="ground" />
          <div className="decor decor-one">●</div><div className="decor decor-two">●</div><div className="decor decor-three">◆</div>
        </section>
      )}

      {screen === "lobby" && (
        <section className="panel-screen">
          <div className="lobby-card">
            <p className="eyebrow">PRIVATE ROOM</p>
            <h2>GET READY!</h2>
            <div className="room-code"><span>{roomCode}</span><button onClick={() => navigator.clipboard?.writeText(location.href)}>COPY LINK</button></div>
            <div className="players-heading"><span>PLAYERS</span><b>{players.length}/10</b></div>
            <div className="player-list">
              {players.map((p, index) => <div className="player-row" key={p.id}><span className="avatar" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span><strong>{p.name}{p.id === idRef.current ? " (YOU)" : ""}</strong>{index === 0 && <span className="crown">★</span>}</div>)}
              {!players.length && <div className="empty-state">Waiting for players…</div>}
            </div>
            {isHost ? <button className="primary-btn green wide" disabled={players.length < 2} onClick={startGame}>{players.length < 2 ? "WAITING FOR PLAYERS" : "START GAME →"}</button> : <div className="waiting">HOST IS SETTING UP THE ARENA…</div>}
            <button className="text-btn" onClick={leaveRoom}>LEAVE ROOM</button>
          </div>
        </section>
      )}

      {screen === "game" && gameState && (
        <section className="game-screen">
          <div className="hud"><div><span>TIME</span><strong>{String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</strong></div><div className="it-indicator">{myPlayer?.isIt ? "YOU ARE IT!" : `IT: ${gameState.players.find((p) => p.isIt)?.name ?? "—"}`}</div><div><span>ROOM</span><strong>{roomCode}</strong></div></div>
          <div className="arena">
            <div className="arena-grid" />
            {gameState.players.map((p) => <div key={p.id} className={`player-token ${p.isIt ? "it" : ""} ${p.id === idRef.current ? "me" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.color }}><span>{p.name.slice(0, 1).toUpperCase()}</span><b>{p.name}</b>{p.isIt && <em>IT</em>}</div>)}
            <div className="obstacle o1" /><div className="obstacle o2" /><div className="obstacle o3" /><div className="tree t1">🌳</div><div className="tree t2">🌴</div>
          </div>
          <div className="controls"><div className="wasd"><button>W</button><div><button>A</button><button>S</button><button>D</button></div></div><span>MOVE</span></div>
        </section>
      )}

      {screen === "results" && gameState && (
        <section className="panel-screen"><div className="results-card"><p className="eyebrow">ROUND COMPLETE</p><h2>GAME OVER!</h2><div className="winner">🏆 <strong>{[...gameState.players].sort((a, b) => b.score - a.score)[0]?.name}</strong><span>TOP TAGGER</span></div><div className="score-list">{[...gameState.players].sort((a, b) => b.score - a.score).map((p, i) => <div key={p.id}><span>#{i + 1}</span><strong>{p.name}</strong><b>{p.score} tags</b></div>)}</div><button className="primary-btn pink wide" onClick={playAgain}>PLAY AGAIN →</button><button className="text-btn" onClick={leaveRoom}>EXIT</button></div></section>
      )}

      {error && <div className="toast">{error}<button onClick={() => setError("")}>×</button></div>}
      {!envReady && <div className="config-banner">DEMO BUILD: Supabase is not connected yet.</div>}

      {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-card" onClick={(e) => e.stopPropagation()}><button className="close" onClick={() => setSettingsOpen(false)}>×</button><h2>SETTINGS</h2><label className="setting-row"><span>SOUND</span><button className={`toggle ${soundOn ? "active" : ""}`} onClick={() => { const next = !soundOn; setSoundOn(next); localStorage.setItem("tag-arena-sound", next ? "on" : "off"); }}>{soundOn ? "ON" : "OFF"}</button></label><p>Settings save automatically.</p><button className="primary-btn blue wide" onClick={() => setSettingsOpen(false)}>CLOSE</button></div></div>}
    </main>
  );
}
