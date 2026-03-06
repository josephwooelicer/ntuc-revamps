import { getMigrationStatus } from "./migrate.js";

const status = getMigrationStatus();

console.log("Applied migrations:");
for (const row of status.applied) {
  console.log(`- ${row.version} (${row.applied_at})`);
}

console.log("\nTables:");
for (const table of status.tables) {
  console.log(`- ${table}`);
}
