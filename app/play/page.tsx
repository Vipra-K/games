"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

type Input = { up: boolean; down: boolean; left: boolean; right: boolean };
type Player = { id: string; name: string; x: number; y: number; color: string; isIt: boolean; score: number };
type GameState = { status: "playing" | "finished"; players: Player[]; startedAt: number; endsAt: number; lastTagAt: number };
type Presence = { id: string; name: string; color: string; host: boolean };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://cnjjrbdyrklbdhznissp.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_BhL_6mDMqj5W96jA3rbVlQ_Gi-WZ3Fn";
const COLORS = ["#ff3f88", "#3d8bff", "#18c981", "#ffb62e", "#9b6cff", "#ff5d4d", "#16b8c8", "#ef6fc1"];
const GAME_SECONDS = 120;
const SPEED = 0.62;
const TAG_DISTANCE = 7;
const MAX_PLAYERS = 10;

function makeCode() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function move(p: Player, input: Input): Player {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(dx, dy) || 1;
  return { ...p, x: clamp(p.x + (dx / len) * SPEED, 5, 95), y: clamp(p.y + (dy / len) * SPEED, 8, 92) };
}

export default function Play() {
  const supabase = useMemo<SupabaseClient>(() => createClient(SUPABASE_URL, SUPABASE_KEY), []);
  const idRef = useRef("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const hostRef = useRef(false);
  const gameRef = useRef<GameState | null>(null);
  const remoteInputRef = useRef<Map<string, Input>>(new Map());
  const loopRef = useRef<number | null>(null);
  const inputRef = useRef<Input>({ up: false, down: false, left: false, right: false });
  const [screen, setScreen] = useState<"home" | "lobby" | "game" | "results">("home");
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [seconds, setSeconds] = useState(GAME_SECONDS);

  useEffect(() => {
    idRef.current = crypto.randomUUID();
    setName(localStorage.getItem("tag-arena-name") || "");
    setSoundOn(localStorage.getItem("tag-arena-sound") !== "off");
    const queryRoom = new URLSearchParams(location.search).get("room");
    if (queryRoom) setRoom(queryRoom.toUpperCase().slice(0, 5));
  }, []);

  useEffect(() => { gameRef.current = game; }, [game]);

  useEffect(() => {
    const key = (e: KeyboardEvent, down: boolean) => {
      if (screen !== "game") return;
      const k = e.key.toLowerCase();
      if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(k)) e.preventDefault();
      if (k === "w" || k === "arrowup") inputRef.current.up = down;
      if (k === "s" || k === "arrowdown") inputRef.current.down = down;
      if (k === "a" || k === "arrowleft") inputRef.current.left = down;
      if (k === "d" || k === "arrowright") inputRef.current.right = down;
    };
    const down = (e: KeyboardEvent) => key(e, true);
    const up = (e: KeyboardEvent) => key(e, false);
    addEventListener("keydown", down); addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, [screen]);

  useEffect(() => () => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    channelRef.current?.unsubscribe();
  }, []);

  function saveName(v: string) { const clean = v.slice(0, 16); setName(clean); localStorage.setItem("tag-arena-name", clean); }

  async function connect(code: string, host: boolean) {
    const cleanRoom = code.trim().toUpperCase();
    const cleanName = name.trim().slice(0, 16);
    setError("");
    if (!cleanName) return setError("Enter a nickname first.");
    if (!/^[A-Z0-9]{4,5}$/.test(cleanRoom)) return setError("Enter a valid room code.");

    channelRef.current?.unsubscribe();
    hostRef.current = host;
    const channel = supabase.channel(`tag-arena-${cleanRoom}`, { config: { presence: { key: idRef.current } } });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Presence>();
      const presence = Object.values(state).flat();
      setPlayers(current => presence.map(p => current.find(x => x.id === p.id) || ({ id: p.id, name: p.name, color: p.color, x: 50, y: 50, isIt: false, score: 0 })));
    });
    channel.on("broadcast", { event: "input" }, ({ payload }) => {
      if (!hostRef.current || !payload?.id) return;
      remoteInputRef.current.set(payload.id, payload.input as Input);
    });
    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      if (!payload?.state) return;
      gameRef.current = payload.state;
      setGame(payload.state); setPlayers(payload.state.players); setSeconds(GAME_SECONDS); setScreen("game");
    });
    channel.on("broadcast", { event: "game-state" }, ({ payload }) => {
      if (!payload?.state) return;
      gameRef.current = payload.state;
      setGame(payload.state); setPlayers(payload.state.players);
      if (payload.state.status === "finished") setScreen("results");
    });
    channel.on("broadcast", { event: "game-stop" }, () => { setGame(null); setScreen("lobby"); });
    channel.on("broadcast", { event: "host-left" }, () => setError("The host left the room. Please create a new room."));

    await channel.subscribe(async status => {
      if (status !== "SUBSCRIBED") {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("Could not connect to the multiplayer room.");
        return;
      }
      await channel.track({ id: idRef.current, name: cleanName, color: COLORS[Math.floor(Math.random() * COLORS.length)], host });
      setRoom(cleanRoom); setConnected(true); setScreen("lobby");
      history.replaceState(null, "", `?room=${cleanRoom}`);
    });
  }

  async function createRoom() { await connect(makeCode(), true); }
  async function joinRoom() { await connect(room, false); }

  function startGame() {
    if (!hostRef.current || !channelRef.current || players.length < 2 || players.length > MAX_PLAYERS) return;
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const now = Date.now();
    const initial: GameState = {
      status: "playing", startedAt: now, endsAt: now + GAME_SECONDS * 1000, lastTagAt: 0,
      players: shuffled.map((p, i) => ({ ...p, x: 12 + Math.random() * 76, y: 14 + Math.random() * 70, isIt: i === 0, score: 0 }))
    };
    remoteInputRef.current.clear();
    gameRef.current = initial; setGame(initial); setPlayers(initial.players); setSeconds(GAME_SECONDS); setScreen("game");
    channelRef.current.send({ type: "broadcast", event: "game-start", payload: { state: initial } });
    runHostLoop();
  }

  function runHostLoop() {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    const tick = () => {
      const state = gameRef.current;
      const channel = channelRef.current;
      if (!state || state.status !== "playing" || !channel || !hostRef.current) return;
      const now = Date.now();
      const nextPlayers = state.players.map(p => move(p, p.id === idRef.current ? inputRef.current : (remoteInputRef.current.get(p.id) || { up:false,down:false,left:false,right:false })));
      let next: GameState = { ...state, players: nextPlayers };
      if (now >= state.endsAt) {
        next = { ...next, status: "finished" };
      } else if (now - state.lastTagAt >= 900) {
        const it = next.players.find(p => p.isIt);
        const victim = it && next.players.find(p => p.id !== it.id && Math.hypot(p.x - it.x, p.y - it.y) <= TAG_DISTANCE);
        if (it && victim) {
          next = { ...next, lastTagAt: now, players: next.players.map(p => p.id === it.id ? { ...p, isIt:false, score:p.score + 1 } : p.id === victim.id ? { ...p, isIt:true } : p) };
        }
      }
      gameRef.current = next; setGame(next); setPlayers(next.players); setSeconds(Math.max(0, Math.ceil((next.endsAt - now) / 1000)));
      channel.send({ type: "broadcast", event: "game-state", payload: { state: next } });
      if (next.status === "finished") { setScreen("results"); return; }
      loopRef.current = requestAnimationFrame(tick);
    };
    loopRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    if (screen !== "game" || hostRef.current || !channelRef.current) return;
    const timer = window.setInterval(() => channelRef.current?.send({ type: "broadcast", event: "input", payload: { id: idRef.current, input: inputRef.current } }), 50);
    return () => clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    if (screen !== "game" || !game) return;
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000))), 200);
    return () => clearInterval(timer);
  }, [screen, game]);

  async function copyInvite() {
    const url = `${location.origin}/?room=${room}`;
    await navigator.clipboard?.writeText(url);
    setError("Invite link copied!");
  }

  async function playAgain() {
    if (!hostRef.current) return;
    setGame(null); setScreen("lobby");
    await channelRef.current?.send({ type: "broadcast", event: "game-stop", payload: {} });
  }

  async function leaveRoom() {
    if (hostRef.current) await channelRef.current?.send({ type: "broadcast", event: "host-left", payload: {} });
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    await channelRef.current?.unsubscribe();
    channelRef.current = null; hostRef.current = false; remoteInputRef.current.clear();
    setConnected(false); setPlayers([]); setGame(null); setRoom(""); setScreen("home");
    history.replaceState(null, "", "/");
  }

  const me = game?.players.find(p => p.id === idRef.current);
  const winner = game?.players.slice().sort((a,b) => b.score - a.score)[0];

  return <main className="app-shell">
    <div className="sky-glow" />
    <header className="topbar">
      <button className="brand" onClick={() => screen !== "home" && void leaveRoom()}><span className="brand-tag">TAG</span><span className="brand-arena">ARENA</span></button>
      <div className="top-actions">{connected && <span className="connection"><i /> ONLINE</span>}<button className="icon-btn" onClick={() => setSettingsOpen(true)}>⚙</button></div>
    </header>

    {screen === "home" && <section className="home-screen">
      <div className="hero-copy"><p className="eyebrow">REAL-TIME • FRIENDS • CHAOS</p><h1>TAG<br/><span>ARENA</span></h1><p className="subtitle">Run. Dodge. Tag your friends.<br/>Last one standing gets bragging rights.</p></div>
      <div className="home-card"><label>YOUR NICKNAME</label><input value={name} maxLength={16} onChange={e => saveName(e.target.value)} placeholder="Enter your name"/>
        <button className="primary-btn pink" onClick={() => void createRoom()}>CREATE ROOM <span>→</span></button><div className="or"><span/> OR <span/></div>
        <div className="join-row"><input value={room} maxLength={5} onChange={e => setRoom(e.target.value.toUpperCase())} placeholder="ROOM CODE"/><button className="primary-btn blue" onClick={() => void joinRoom()}>JOIN</button></div>
        <p className="tiny">Share the room link with your friends.</p></div>
      <div className="ground"/><div className="decor decor-one">●</div><div className="decor decor-two">●</div><div className="decor decor-three">◆</div>
    </section>}

    {screen === "lobby" && <section className="panel-screen"><div className="lobby-card"><p className="eyebrow">PRIVATE ROOM</p><h2>GET READY!</h2>
      <div className="room-code"><span>{room}</span><button onClick={() => void copyInvite()}>COPY LINK</button></div>
      <div className="players-heading"><span>PLAYERS</span><b>{players.length}/{MAX_PLAYERS}</b></div><div className="player-list">
        {players.map((p,i)=><div className="player-row" key={p.id}><span className="avatar" style={{background:p.color}}>{p.name[0]?.toUpperCase()}</span><strong>{p.name}{p.id===idRef.current ? " (YOU)" : ""}</strong>{i===0 && <span className="crown">★</span>}</div>)}
        {!players.length && <div className="empty-state">Waiting for players…</div>}</div>
      {hostRef.current ? <button className="primary-btn green wide" disabled={players.length<2} onClick={startGame}>{players.length<2 ? "WAITING FOR PLAYERS" : "START GAME →"}</button> : <div className="waiting">HOST IS SETTING UP THE ARENA…</div>}
      <button className="text-btn" onClick={() => void leaveRoom()}>LEAVE ROOM</button></div></section>}

    {screen === "game" && game && <section className="game-screen"><div className="hud"><div><span>TIME</span><strong>{String(Math.floor(seconds/60)).padStart(2,"0")}:{String(seconds%60).padStart(2,"0")}</strong></div><div className="it-indicator">{me?.isIt ? "YOU ARE IT!" : `IT: ${game.players.find(p=>p.isIt)?.name || "—"}`}</div><div><span>TAGS</span><strong>{me?.score || 0}</strong></div></div>
      <div className="arena"><div className="arena-grid"/><div className="tree t1">🌳</div><div className="tree t2">🌴</div><div className="obstacle o1"/><div className="obstacle o2"/><div className="obstacle o3"/>
        {game.players.map(p=><div key={p.id} className={`player-token ${p.isIt ? "it" : ""} ${p.id===idRef.current ? "me" : ""}`} style={{left:`${p.x}%`,top:`${p.y}%`,background:p.color}}><span>●</span>{p.isIt && <em>IT</em>}<b>{p.name}</b></div>)}
      </div>
      <div className="controls"><span>MOVE</span><div className="wasd"><div><button onPointerDown={()=>inputRef.current.up=true} onPointerUp={()=>inputRef.current.up=false} onPointerLeave={()=>inputRef.current.up=false}>W</button></div><div><button onPointerDown={()=>inputRef.current.left=true} onPointerUp={()=>inputRef.current.left=false} onPointerLeave={()=>inputRef.current.left=false}>A</button><button onPointerDown={()=>inputRef.current.down=true} onPointerUp={()=>inputRef.current.down=false} onPointerLeave={()=>inputRef.current.down=false}>S</button><button onPointerDown={()=>inputRef.current.right=true} onPointerUp={()=>inputRef.current.right=false} onPointerLeave={()=>inputRef.current.right=false}>D</button></div></div></div>
    </section>}

    {screen === "results" && game && <section className="panel-screen"><div className="results-card"><p className="eyebrow">ROUND COMPLETE</p><h2>GAME OVER</h2><div className="winner"><span>TOP TAGGER</span><strong>{winner?.name || "—"}</strong></div><div className="score-list">{game.players.slice().sort((a,b)=>b.score-a.score).map((p,i)=><div key={p.id}><span>#{i+1}</span><strong>{p.name}</strong><b>{p.score} tags</b></div>)}</div><button className="primary-btn green wide" disabled={!hostRef.current} onClick={() => void playAgain()}>{hostRef.current ? "PLAY AGAIN →" : "WAITING FOR HOST"}</button><button className="text-btn" onClick={() => void leaveRoom()}>LEAVE ROOM</button></div></section>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)setSettingsOpen(false)}}><div className="settings-card"><button className="close" onClick={()=>setSettingsOpen(false)}>×</button><h2>SETTINGS</h2><div className="setting-row"><span>SOUND</span><button className={`toggle ${soundOn?"active":""}`} onClick={()=>{const v=!soundOn;setSoundOn(v);localStorage.setItem("tag-arena-sound",v?"on":"off")}}>{soundOn?"ON":"OFF"}</button></div><p>Settings are saved automatically on this device.</p><button className="primary-btn pink wide" onClick={()=>setSettingsOpen(false)}>CLOSE</button></div></div>}
    {error && <div className="toast">{error}<button onClick={()=>setError("")}>×</button></div>}
  </main>;
}
