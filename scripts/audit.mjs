/**
 * PROJECT AUDIT SCRIPT
 * 
 * Comprehensive audit of all project assets, references, and configurations.
 * Detects broken paths, missing assets, invalid references, and conflicts.
 *
 * Usage: node scripts/audit.mjs
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..', '..');
const ROOT = __dirname;

const issues = [];

function report(type, severity, file, message) {
  const icon = severity === 'ERROR' ? '✗' : severity === 'WARN' ? '⚠' : '·';
  issues.push({ type, severity, file, message });
  console.log(`  ${icon} [${severity}] ${file}: ${message}`);
}

function hasExt(file, ext) {
  return extname(file).toLowerCase() === ext.toLowerCase();
}

// ─── 1. Check all JSON files are valid ───
console.log('\n─── JSON Validation ───');
const jsonFiles = [];

function collectJSON(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'backup') {
      collectJSON(full);
    } else if (entry.isFile() && hasExt(entry.name, '.json')) {
      jsonFiles.push(full);
    }
  }
}
collectJSON(ROOT);

for (const file of jsonFiles) {
  try {
    const content = readFileSync(file, 'utf-8');
    JSON.parse(content);
  } catch (e) {
    report('JSON', 'ERROR', file.replace(ROOT + '\\', ''), `Invalid JSON: ${e.message}`);
  }
}

// ─── 2. Check HTML image references ───
console.log('\n─── Image Reference Audit ───');
const htmlFiles = [];

function collectHTML(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'backup') {
      collectHTML(full);
    } else if (entry.isFile() && hasExt(entry.name, '.html')) {
      htmlFiles.push(full);
    }
  }
}
collectHTML(ROOT);

const imageRefs = {};

for (const file of htmlFiles) {
  const content = readFileSync(file, 'utf-8');
  const srcMatches = content.matchAll(/src="([^"]+\.(?:png|jpg|jpeg|gif|svg|webp))"/gi);
  for (const match of srcMatches) {
    const imgSrc = match[1];
    if (!imageRefs[imgSrc]) imageRefs[imgSrc] = [];
    imageRefs[imgSrc].push(file.replace(ROOT + '\\', ''));
  }
  
  // Check inline JS image references in data
  const jsImgMatches = content.matchAll(/image:\s*["']([^"']+)["']/g);
  for (const match of jsImgMatches) {
    const imgSrc = match[1];
    if (imgSrc.startsWith('http') || imgSrc.startsWith('data:')) continue;
    if (!imageRefs[imgSrc]) imageRefs[imgSrc] = [];
    imageRefs[imgSrc].push(file.replace(ROOT + '\\', '') + ' (JS data)');
  }
}

// Check for local image existence
for (const [imgSrc, sources] of Object.entries(imageRefs)) {
  // Only check local paths
  if (imgSrc.startsWith('http') || imgSrc.startsWith('data:') || imgSrc.startsWith('//')) continue;
  
  const cleanPath = imgSrc.startsWith('/') ? imgSrc.substring(1) : imgSrc;
  const fullPath = resolve(ROOT, cleanPath);
  
  if (!existsSync(fullPath)) {
    const inDist = existsSync(resolve(ROOT, 'dist', cleanPath));
    if (!inDist) {
      report('ASSET', 'ERROR', sources[0], `Missing image: ${imgSrc} (not in source or dist)`);
    } else {
      report('ASSET', 'WARN', sources[0], `Image only in dist/: ${imgSrc}`);
    }
  }
}

// ─── 3. Check all CSS @import targets ───
console.log('\n─── CSS Import Audit ───');
const cssFiles = [];

function collectCSS(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'backup') {
      collectCSS(full);
    } else if (entry.isFile() && hasExt(entry.name, '.css')) {
      cssFiles.push(full);
    }
  }
}
collectCSS(resolve(ROOT, 'src'));

// Check that main.css imports all target files
const mainCssPath = resolve(ROOT, 'src/css/main.css');
if (existsSync(mainCssPath)) {
  const mainCss = readFileSync(mainCssPath, 'utf-8');
  const imports = mainCss.matchAll(/@import\s+["'].\/?([^"']+)["']/g);
  for (const imp of imports) {
    const targetRel = imp[1];
    const targetPath = resolve(dirname(mainCssPath), targetRel);
    if (!existsSync(targetPath)) {
      report('CSS', 'ERROR', 'src/css/main.css', `Import target not found: ${targetRel}`);
    }
  }
}

// ─── 4. Check JS module imports ───
console.log('\n─── JS Import Audit ───');
const jsFiles = [];

function collectJS(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'backup') {
      collectJS(full);
    } else if (entry.isFile() && (hasExt(entry.name, '.js') || hasExt(entry.name, '.mjs'))) {
      jsFiles.push(full);
    }
  }
}
collectJS(resolve(ROOT, 'src'));
collectJS(resolve(ROOT, 'scripts'));

for (const file of jsFiles) {
  const content = readFileSync(file, 'utf-8');
  const relPath = file.replace(ROOT + '\\', '');
  
  // Skip non-module files
  if (!content.includes('import ')) continue;
  
  const importMatches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
  for (const match of importMatches) {
    const importPath = match[1];
    
    // Skip external packages
    if (importPath.startsWith('.') || importPath.startsWith('@')) {
      // Resolve relative imports
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const resolved = resolve(dirname(file), importPath);
        const extensions = ['.js', '.mjs', '/index.js', '/index.mjs'];
        let found = false;
        for (const ext of extensions) {
          if (existsSync(resolved + ext)) { found = true; break; }
          if (existsSync(resolve(resolved, 'index' + ext))) { found = true; break; }
          if (ext.startsWith('/') && existsSync(resolved.replace(/\/[^/]*$/, '') + ext)) { found = true; break; }
        }
        if (!found && existsSync(resolved) && statSync(resolved).isFile()) {
          found = true;
        }
        if (!found) {
          report('JS', 'WARN', relPath, `Possible broken import: "${importPath}" -> resolved: ${resolved}`);
        }
      }
    }
  }
}

// ─── 5. Check Vite config paths ───
console.log('\n─── Vite Config Audit ───');
const viteConfigPath = resolve(ROOT, 'vite.config.js');
if (existsSync(viteConfigPath)) {
  const viteConfig = readFileSync(viteConfigPath, 'utf-8');
  const aliasMatches = viteConfig.matchAll(/["']([@]\w+)["']:\s*resolve\([^,]+,\s*["']([^"']+)["']\)/g);
  for (const match of aliasMatches) {
    const alias = match[1];
    const targetDir = match[2];
    const resolved = resolve(ROOT, targetDir);
    if (!existsSync(resolved)) {
      report('VITE', 'ERROR', 'vite.config.js', `Alias "${alias}" points to non-existent directory: ${targetDir}`);
    }
  }
  
  // Check HTML entry files exist
  const htmlEntryMatches = viteConfig.matchAll(/\b(name\s*:\s*["']([^"']+)["']|resolve\([^,]+,\s*["']([^"']+\.html)["']\))/g);
  for (const match of htmlEntryMatches) {
    const name = match[2];
    const htmlPath = match[3];
    if (name && name !== '') {
      const entryPath = resolve(ROOT, name + '.html');
      if (!existsSync(entryPath)) {
        report('VITE', 'WARN', 'vite.config.js', `HTML entry "${name}" -> ${name}.html not found`);
      }
    }
    if (htmlPath && !htmlPath.startsWith('src')) {
      const entryPath = resolve(ROOT, htmlPath);
      if (!existsSync(entryPath)) {
        report('VITE', 'WARN', 'vite.config.js', `HTML entry not found: ${htmlPath}`);
      }
    }
  }
}

// ─── 6. Check package.json scripts reference real files ───
console.log('\n─── Package.json Script Audit ───');
const pkgPath = resolve(ROOT, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (pkg.scripts) {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      const scriptFiles = script.matchAll(/node\s+([^\s&|;]+)/g);
      for (const match of scriptFiles) {
        const scriptPath = resolve(ROOT, match[1]);
        if (!existsSync(scriptPath)) {
          report('PKG', 'WARN', 'package.json', `Script "${name}" references missing file: ${match[1]}`);
        }
      }
    }
  }
}

// ─── 7. Check for CSS variable conflicts ───
console.log('\n─── CSS Variable Consistency ───');
const allCSS = [];

function collectAllCSS(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'backup') {
      collectAllCSS(full);
    } else if (entry.isFile() && hasExt(entry.name, '.css')) {
      allCSS.push(full);
    }
  }
}
collectAllCSS(resolve(ROOT, 'src'));

const definedVars = new Set();
const usedVars = new Map();

for (const file of allCSS) {
  const content = readFileSync(file, 'utf-8');
  const defs = content.matchAll(/--([\w-]+)\s*:/g);
  for (const d of defs) definedVars.add(d[1]);
  
  const uses = content.matchAll(/var\(--([\w-]+)\)/g);
  for (const u of uses) {
    const key = u[1];
    if (!usedVars.has(key)) usedVars.set(key, []);
    usedVars.get(key).push(file.replace(ROOT + '\\', ''));
  }
}

for (const [varname, files] of usedVars) {
  if (!definedVars.has(varname)) {
    report('CSS', 'WARN', files[0], `Undefined variable: --${varname} (used in ${files.length} file(s))`);
  }
}

// ─── Summary ───
console.log('\n═══════════════════════════════════════════════════');
console.log(`  AUDIT COMPLETE`);
console.log(`  Issues found: ${issues.length}`);
console.log('═══════════════════════════════════════════════════');

const bySeverity = {};
for (const issue of issues) {
  bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
}

for (const [sev, count] of Object.entries(bySeverity)) {
  console.log(`  ${sev}: ${count}`);
}

console.log('\n');
