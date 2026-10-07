import fs from 'node:fs';
import path from 'node:path';
export const stateDir = () => path.resolve(process.env.SENTINEL_HOME || '.sentinel');
export const ensure = (...p) => { const d = path.join(stateDir(), ...p); fs.mkdirSync(d, { recursive: true }); return d; };
