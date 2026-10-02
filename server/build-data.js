import { buildRepositories } from "./discover.js";

const data = buildRepositories();
console.log(JSON.stringify(data.meta, null, 2));
for (const repo of data.repositories.slice(0, 5)) {
  console.log(`- ${repo.name}: ${repo.chats.length} chats`);
}
