// Entwicklung: Vite-Server + Electron-Build im Watch-Modus + Electron starten.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen(5199);
const url = 'http://localhost:5199';
const esb = spawn(process.execPath, ['scripts/build-electron.mjs', '--watch'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1200));
const electronPath = (await import('electron')).default;
const el = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
el.on('exit', () => {
  esb.kill();
  server.close();
  process.exit(0);
});
