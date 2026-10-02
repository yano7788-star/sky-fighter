# Sky Fighter (Cyber Strike: Neon Warfare)

Single-file HTML5 canvas shooter, deployed via GitHub Pages (repo: yano7788-star/sky-fighter).

## Layout
- `index.html` — the live game (served by Pages). All JS/CSS inline, ~1200 lines. Edit this.
- `Cyber_Strike.html`, `Cyber_Strike-old.html` — older/large variants (embedded assets); do not edit unless asked.
- Assets in repo root: `bg1-5.png` (stage backgrounds), `boss1-5.png`, `player.png`, `bomb.png`, `skill1/2.jpg`, `Startscreen.png`, two mp3 BGM files.

## index.html structure (search for the `// ====` banners)
Game state (`START/PLAYING/GAMECLEAR/GAMEOVER`), sprite background removal, `BOSS_CONFIGS`, WebAudio synth (`playSound`), input (touch + mouse, bomb button), `spawnBoss`, stage backgrounds, draw functions, main `loop()`.

## Workflow
- `main` is what GitHub Pages publishes — never commit directly to it. Work on `develop` (or feature branches off it), merge to `main` only when asked.
- Run locally: `npx serve -l 5180 .` (see `.claude/launch.json`), open http://localhost:5180.
- No build step, no tests. Verify changes by running the game in the browser and checking the console for errors.
- Keep it mobile-friendly (touch controls, viewport-fit) and a single self-contained `index.html`.
- UI text and comments are in Korean; match that.
