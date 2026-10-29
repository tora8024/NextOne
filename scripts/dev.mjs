import { spawn } from 'node:child_process';
import path from 'node:path';

const bin = (name) => path.join(process.cwd(), 'node_modules', '.bin', name);
const api = spawn(bin('tsx'), ['watch', 'server/index.ts'], { stdio: 'inherit' });
const web = spawn(bin('vite'), ['--host', '127.0.0.1', '--port', '5173'], { stdio: 'inherit' });

function shutdown() {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of [api, web]) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exit(code);
    }
  });
}
