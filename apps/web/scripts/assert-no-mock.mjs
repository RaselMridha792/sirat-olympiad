// Runs after `next build`: fails the build if the dev-only mock data source reached the production
// output (owner rule: mock data never ships). The mock module carries the marker string below.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MARKER = 'SIRAT_MOCK_DATA_SOURCE';
const roots = ['.next/server', '.next/static'];

if (!existsSync('.next/server')) {
  console.error('assert-no-mock: .next/server not found; run it after next build');
  process.exit(1);
}

let scanned = 0;
const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(c|m)?js$|\.json$|\.html$|\.rsc$/.test(name)) {
      scanned += 1;
      if (readFileSync(path, 'utf8').includes(MARKER)) hits.push(relative('.', path));
    }
  }
};
for (const root of roots) if (existsSync(root)) walk(root);

if (hits.length > 0) {
  console.error(
    `assert-no-mock: mock data source found in the production build:\n  ${hits.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(`assert-no-mock: OK, no mock data source in ${scanned} build files`);
