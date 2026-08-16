/**
 * READ-ONLY Phase C preflight: production secret readiness.
 *
 * Reports ONLY metadata — presence, whether the value matches a known
 * development/default placeholder, length, and character-class diversity.
 * NEVER prints, logs, hashes, or returns any secret value or any substring
 * of one. Performs no writes of any kind.
 *
 * Usage:
 *   railway run -s veteransledger sh -c 'npx ts-node src/scripts/prod-secret-preflight.ts'
 */

/** Exactly the list the app's startup guard uses (src/config/app.ts:93-97). */
const GUARD_WEAK = [
  "dev-secret-change-in-production",
  "dev-jwt-secret-change-in-production",
  "change-me",
];

/** Other known placeholders shipped in .env.example / prisma/seed.ts. */
const OTHER_PLACEHOLDERS = [
  "change-me-to-a-long-random-secret-at-least-64-chars",
  "change-me-to-a-different-long-random-secret",
  "change-me-in-production",
  "changeme123",
  "your-smtp-password",
  "password",
  "admin",
  "secret",
];

/** Fallbacks applied by optional() in src/config/app.ts when the var is unset. */
const FALLBACK: Record<string, string> = {
  SESSION_SECRET: "dev-secret-change-in-production",
  JWT_SECRET: "dev-jwt-secret-change-in-production",
  ADMIN_PASSWORD: "change-me",
};

/** Minimum lengths implied by .env.example guidance. */
const MIN_LEN: Record<string, number> = { SESSION_SECRET: 64, JWT_SECRET: 32, ADMIN_PASSWORD: 12 };

function classes(s: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(s)).length;
}

function main() {
  console.log("Phase C preflight — secret readiness (values never printed)\n");
  const results: { name: string; present: boolean; isDefault: boolean; guardPass: boolean; len: number; cls: number; minOk: boolean }[] = [];

  for (const name of ["SESSION_SECRET", "JWT_SECRET", "ADMIN_PASSWORD"]) {
    const raw = process.env[name];
    const present = typeof raw === "string" && raw.length > 0;
    // Replicate optional(): unset -> fallback, which is what the guard would see.
    const effective = present ? (raw as string) : FALLBACK[name];
    const isGuardWeak = GUARD_WEAK.includes(effective);
    const isOtherPlaceholder = OTHER_PLACEHOLDERS.includes(effective);
    results.push({
      name,
      present,
      isDefault: isGuardWeak || isOtherPlaceholder,
      guardPass: !isGuardWeak,
      len: effective.length,
      cls: classes(effective),
      minOk: effective.length >= (MIN_LEN[name] ?? 0),
    });
  }

  console.log("VARIABLE          PRESENT   DEFAULT?       GUARD        LEN   CLASSES  MIN-LEN");
  console.log("-".repeat(78));
  for (const r of results) {
    console.log(
      `${r.name.padEnd(17)} ${(r.present ? "yes" : "NO").padEnd(9)} ${(r.isDefault ? "DEFAULT" : "non-default").padEnd(14)} ${(r.guardPass ? "PASS" : "FAIL").padEnd(12)} ${String(r.len).padStart(3)}   ${r.cls}/4      ${r.minOk ? "ok" : "SHORT"}`,
    );
  }

  const allPresent = results.every((r) => r.present);
  const noneDefault = results.every((r) => !r.isDefault);
  const allGuardPass = results.every((r) => r.guardPass);

  console.log("\n=== VERDICT ===");
  console.log(`  [${allPresent ? "PASS" : "FAIL"}] all three variables present in the production environment`);
  console.log(`  [${noneDefault ? "PASS" : "FAIL"}] none matches a known development/default placeholder`);
  console.log(`  [${allGuardPass ? "PASS" : "FAIL"}] all three satisfy the startup guard (src/config/app.ts:93)`);
  console.log(
    `\n  NODE_ENV=production is ${allGuardPass ? "SAFE" : "NOT SAFE"} to set: the container would ${allGuardPass ? "start normally" : "FAIL TO BOOT"}.`,
  );
  console.log(`\n  Current NODE_ENV: ${process.env.NODE_ENV ?? "(unset)"}`);
  console.log("\nNo secret value was printed, logged, or returned. Read-only.\n");
}

main();
