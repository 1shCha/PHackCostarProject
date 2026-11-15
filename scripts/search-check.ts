// Try the tenant search from the terminal:
// node --conditions=react-server --import tsx --env-file=.env.local scripts/search-check.ts "barber, 1500-2000 sq ft, Houston"

import { searchSpaces } from "../src/lib/search";

async function main() {
  const queries = process.argv.slice(2).length ? process.argv.slice(2) : [
    "I'm a barber looking for 1,500–2,000 sq ft in Houston",
    "I'm a dermatologist looking for 5,000–7,000 sq ft in Houston",
    "law firm, 3k-4k sf, Houston",
  ];
  for (const text of queries) {
    const r = await searchSpaces(text, 6);
    console.log(`\n"${text}"`);
    console.log(`→ ${r.profile.name} · ${r.query.sqft_min ?? "?"}–${r.query.sqft_max ?? "?"} sq ft · ${r.query.city ?? "any city"} · ${r.total} suites`);
    for (const s of r.results) {
      const rent = s.asking_rent ? `$${s.asking_rent}/sf asking` : "no asking rent";
      console.log(`  ${s.score} ${s.badge.padEnd(10)} ${s.address} ${s.suite} · ${s.sqft.toLocaleString()} sf · ${rent} · scan: ${s.scan} ` +
        `[size ${s.score_parts.size}, history ${s.score_parts.history}, built-in ${s.score_parts.built_in}]`);
      for (const why of s.reasons) console.log(`      · ${why}`);
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
