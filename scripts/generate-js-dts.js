import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve('src');

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      yield path.join(dir, entry.name);
    }
  }
}

for (const file of walk(srcDir)) {
  const baseName = path.basename(file, '.ts');
  const jsDtsPath = `${file}.js.d.ts`;
  const content = `export * from './${baseName}';\n`;
  if (fs.existsSync(jsDtsPath) && fs.readFileSync(jsDtsPath, 'utf-8') === content) {
    continue;
  }
  fs.writeFileSync(jsDtsPath, content);
}
