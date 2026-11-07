import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates the Hexagonal Architecture layer constraint:
 * `src/domain` MUST NOT import from:
 * - src/application
 * - src/adapters
 * - src/server
 * - web
 * - or external I/O libraries (better-sqlite3, express, @google/genai, pino, etc.)
 */

const DOMAIN_DIR = path.resolve(process.cwd(), 'src/domain');
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*(application|adapters|server|web)[^'"]*['"]/,
  /import\s+['"][^'"]*(application|adapters|server|web)[^'"]*['"]/,
  /require\(['"][^'"]*(application|adapters|server|web)[^'"]*['"]\)/,
  /from\s+['"](better-sqlite3|express|@google\/genai|pino|helmet|cookie-parser)['"]/,
  /import\s+['"](better-sqlite3|express|@google\/genai|pino|helmet|cookie-parser)['"]/
];

function checkDirectory(dir: string): { errors: string[]; fileCount: number } {
  const errors: string[] = [];
  let fileCount = 0;

  if (!fs.existsSync(dir)) {
    return { errors: [`Domain directory not found: ${dir}`], fileCount: 0 };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = checkDirectory(fullPath);
      errors.push(...sub.errors);
      fileCount += sub.fileCount;
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      fileCount++;
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            errors.push(
              `[Layer Violation] ${path.relative(process.cwd(), fullPath)}:${index + 1} -> "${line.trim()}"`
            );
          }
        }
      });
    }
  }

  return { errors, fileCount };
}

console.log('🔍 Checking architectural boundaries in src/domain/...');
const result = checkDirectory(DOMAIN_DIR);

if (result.errors.length > 0) {
  console.error('\n❌ Architectural boundary violations detected:');
  result.errors.forEach((err) => console.error('  ' + err));
  process.exit(1);
}

console.log(`✅ Architecture verified clean! Checked ${result.fileCount} file(s) in src/domain. No outer layer leaks.`);
process.exit(0);
