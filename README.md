# Tag Arena

Real-time multiplayer tag game built with Next.js, React, TypeScript, and Supabase Realtime.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in two browser windows/devices.

1. Enter a nickname.
2. Create a room on one device.
3. Copy the invite link.
4. Open it on the second device and enter a nickname.
5. Start the game from the host device.
6. Move with WASD/arrow keys. Mobile users can use the on-screen controls.

## Multiplayer model

The MVP uses Supabase Realtime Presence + Broadcast. The host browser acts as the authoritative game simulation for movement, collision/tag detection, scoring, and the timer. This keeps the first version simple and playable across devices.

The next production step is moving the authoritative simulation into a dedicated game server so players cannot manipulate game state from the browser.

## Current MVP

- Room codes and invite links
- Multiplayer lobby
- Up to 10 players
- Real-time player movement
- One player starts as IT
- Tag transfers IT to another player
- Tag score and leaderboard
- Two-minute rounds
- Results and play again
- Disconnect/host-left messaging
- Keyboard and mobile controls
- Settings modal with saved sound preference
