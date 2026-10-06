import fs from "node:fs";
import { readUtf8File } from "./read-only.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cursorProjectSlugFromPath,
  decodeProjectSlug,
  repoIdFromKey,
} from "./decode-slug.js";
import { listGlobalSlashCommandSlugs } from "./cursor-commands.js";
import { parseTranscript } from "./parse-transcript.js";
import {
  applyComposerTelemetry,
  loadComposerTelemetry,
  loadSubagentRuns,
} from "./cursor-composer.js";
import { mergeSubagentStatuses } from "./subagent-status.js";
import {
  cursorProjectsDir,
  pathExists,
  workspaceStorageDir,
} from "./paths.js";

function loadWorkspaceFolders() {
  const base = workspaceStorageDir();
  const map = new Map();
  if (!pathExists(base)) return map;

  for (const id of fs.readdirSync(base)) {
    const wj = path.join(base, id, "workspace.json");
    if (!fs.existsSync(wj)) continue;
    try {
      const { folder } = JSON.parse(readUtf8File(wj));
      const folderPath = fileURLToPath(folder);
      map.set(folderPath, {
        name: path.basename(folderPath),
        workspaceId: id,
      });
    } catch {
      /* ignore */
    }
  }
  return map;
}

function findWorkspaceForProjectSlug(slug, workspaces) {
  for (const [folderPath, meta] of workspaces) {
    if (cursorProjectSlugFromPath(folderPath) === slug) {
      return { folderPath, ...meta };
    }
  }

  const decoded = decodeProjectSlug(slug);
  if (decoded.path && workspaces.has(decoded.path)) {
    return { folderPath: decoded.path, ...workspaces.get(decoded.path) };
  }
  if (decoded.path && pathExists(decoded.path)) {
    return { folderPath: decoded.path, name: path.basename(decoded.path) };
  }

  const basenameMatches = [];
  for (const [folderPath, meta] of workspaces) {
    if (path.basename(folderPath) === decoded.name) {
      basenameMatches.push({ folderPath, ...meta });
    }
  }
  if (basenameMatches.length === 1) return basenameMatches[0];

  return { folderPath: decoded.path, name: decoded.name };
}

function listTranscriptFiles(transcriptsDir) {
  const files = [];
  if (!pathExists(transcriptsDir)) return files;
  for (const entry of fs.readdirSync(transcriptsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const jsonl = path.join(transcriptsDir, id, `${id}.jsonl`);
    if (fs.existsSync(jsonl)) files.push({ chatId: id, jsonlPath: jsonl });
  }
  return files;
}

export function buildRepositories() {
  const projectsDir = cursorProjectsDir();
  const workspaces = loadWorkspaceFolders();
  const globalSlashCommands = listGlobalSlashCommandSlugs();
  const repoByKey = new Map();

  if (!pathExists(projectsDir)) {
    return { repositories: [], meta: { projectsDir, chatCount: 0 } };
  }

  for (const slug of fs.readdirSync(projectsDir)) {
    const transcriptsDir = path.join(projectsDir, slug, "agent-transcripts");
    const transcriptFiles = listTranscriptFiles(transcriptsDir);
    if (!transcriptFiles.length) continue;

    const ws = findWorkspaceForProjectSlug(slug, workspaces);
    const decoded = decodeProjectSlug(slug);
    const repoKey = ws.folderPath || slug;

    if (!repoByKey.has(repoKey)) {
      repoByKey.set(repoKey, {
        id: repoIdFromKey(repoKey),
        name: ws.name || decoded.name || slug,
        folderPath: ws.folderPath || null,
        slugs: new Set(),
        chats: [],
      });
    }
    const repo = repoByKey.get(repoKey);
    repo.slugs.add(slug);
    if (ws.name && ws.name.length > repo.name.length) repo.name = ws.name;

    for (const { chatId, jsonlPath } of transcriptFiles) {
      if (repo.chats.some((c) => c.id === chatId)) continue;
      let parsed = parseTranscript(jsonlPath, {
        chatId,
        workspacePath: ws.folderPath,
        globalSlashCommands,
      });
      if (parsed.subAgents?.length) {
        const runs = loadSubagentRuns(chatId);
        const subAgents = runs.length
          ? mergeSubagentStatuses(parsed.subAgents, runs)
          : parsed.subAgents.map((sa) => ({
              ...sa,
              status: "unknown",
              statusSource: "transcript",
            }));
        parsed = {
          ...parsed,
          subAgents,
          meta: {
            ...parsed.meta,
            fieldSources: {
              ...(parsed.meta?.fieldSources || {}),
              ...(runs.length ? { subAgentStatus: "cursor-composer" } : {}),
            },
          },
        };
      }
      const telemetry = loadComposerTelemetry(chatId, {
        workspacePath: ws.folderPath,
        globalSlashCommands,
      });
      repo.chats.push(applyComposerTelemetry(parsed, telemetry));
    }
  }

  const repositories = [...repoByKey.values()]
    .map((r) => {
      r.chats.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
      delete r.slugs;
      return r;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const chatCount = repositories.reduce((n, r) => n + r.chats.length, 0);

  return {
    repositories,
    meta: {
      projectsDir,
      repositoryCount: repositories.length,
      chatCount,
      estimatedContext: true,
      chatSource: "agent-transcripts",
      globalSlashCommands,
    },
  };
}
