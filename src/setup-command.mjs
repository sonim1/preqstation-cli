import { ensureProjectCheckout } from "./worktree-runtime.mjs";
import {
  getDefaultRepoRoots,
  getDefaultSharedMappingPath,
  loadDispatchProjectMappings,
  matchProjectsToRepoRoots,
  readRepoRoots,
} from "./project-mapping.mjs";

function readPluginConfig(config) {
  return config?.plugins?.entries?.["preqstation-dispatcher"]?.config ?? {};
}

function formatMappings(projects) {
  const entries = Object.entries(projects ?? {});
  if (entries.length === 0) {
    return "Current mappings: none";
  }

  return [
    "Current mappings:",
    ...entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, cwd]) => `- ${key} -> ${cwd}`),
  ].join("\n");
}

function formatUsage(projects) {
  return [
    "Usage: /preqstation setup set <PROJECT_KEY> <ABSOLUTE_PATH>",
    "Usage: /preqstation setup auto",
    "       <PROJECT_KEY> <REPO_URL>",
    "       <PROJECT_KEY> <REPO_URL>",
    "Usage: /preqstation setup import",
    "Usage: /preqstation setup unset <PROJECT_KEY>",
    "Usage: /preqstation setup status",
    "",
    formatMappings(projects),
  ].join("\n");
}

export function parseSetupArgs(args) {
  const rawArgs = (args ?? "").trim();
  const firstSpace = rawArgs.search(/\s/u);
  const action =
    (firstSpace === -1 ? rawArgs : rawArgs.slice(0, firstSpace)).toLowerCase() ||
    "status";
  const remainder = firstSpace === -1 ? "" : rawArgs.slice(firstSpace + 1).trim();

  if (action === "set") {
    const tokens = remainder.split(/\s+/u).filter(Boolean);
    return {
      action,
      projectKey: (tokens[0] ?? "").toUpperCase(),
      projectCwd: tokens.slice(1).join(" "),
    };
  }

  if (action === "unset") {
    const tokens = remainder.split(/\s+/u).filter(Boolean);
    return {
      action,
      projectKey: (tokens[0] ?? "").toUpperCase(),
      projectCwd: null,
    };
  }

  if (action === "import") {
    return {
      action,
      projectKey: null,
      projectCwd: null,
    };
  }

  if (action === "auto") {
    return {
      action,
      projectKey: null,
      projectCwd: null,
      payload: remainder,
    };
  }

  return {
    action: "status",
    projectKey: null,
    projectCwd: null,
  };
}

export function parseAutoMappings(payload) {
  const entries = [];
  const invalid = [];

  for (const line of (payload ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const inlineMatches = Array.from(
      trimmed.matchAll(/([A-Za-z0-9_-]+)=(\S+)/gu),
    );
    if (inlineMatches.length > 0) {
      for (const match of inlineMatches) {
        entries.push({
          projectKey: match[1].toUpperCase(),
          repoUrl: match[2],
        });
      }
      continue;
    }

    const spacedMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s+(\S+)$/u);
    if (spacedMatch) {
      entries.push({
        projectKey: spacedMatch[1].toUpperCase(),
        repoUrl: spacedMatch[2],
      });
      continue;
    }

    invalid.push(trimmed);
  }

  return { entries, invalid };
}

function updatePluginProjects(config, nextProjects) {
  return {
    ...config,
    plugins: {
      ...(config.plugins ?? {}),
      entries: {
        ...(config.plugins?.entries ?? {}),
        "preqstation-dispatcher": {
          ...(config.plugins?.entries?.["preqstation-dispatcher"] ?? {}),
          enabled: true,
          config: {
            ...readPluginConfig(config),
            projects: nextProjects,
          },
        },
      },
    },
  };
}

export function createSetupCommandHandler(api, options = {}) {
  return async function handleSetupCommand(ctx) {
    const currentConfig = api.runtime.config.loadConfig();
    const pluginConfig = readPluginConfig(currentConfig);
    const projects = { ...(pluginConfig.projects ?? {}) };
    const parsed = parseSetupArgs(ctx.args);
    const sharedMappingPath =
      options.sharedMappingPath ?? getDefaultSharedMappingPath();
    const repoRoots = readRepoRoots(
      options.repoRoots ??
        pluginConfig.repoRoots ??
        process.env.PREQSTATION_REPO_ROOTS ??
        getDefaultRepoRoots(),
    );

    if (parsed.action === "status") {
      return { text: formatUsage(projects) };
    }

    if (parsed.action === "auto") {
      const { entries, invalid } = parseAutoMappings(parsed.payload);
      if (entries.length === 0) {
        return {
          text: [
            "No project repo hints were provided for /preqstation setup auto.",
            "",
            formatUsage(projects),
          ].join("\n"),
        };
      }

      const discovered = await matchProjectsToRepoRoots(entries, repoRoots);
      const nextProjects = {
        ...projects,
        ...discovered.matched,
      };

      if (Object.keys(discovered.matched).length > 0) {
        const nextConfig = updatePluginProjects(currentConfig, nextProjects);
        await api.runtime.config.writeConfigFile(nextConfig);
      }

      return {
        text: [
          `Matched ${Object.keys(discovered.matched).length} PREQ project mapping${Object.keys(discovered.matched).length === 1 ? "" : "s"} under ${discovered.repoRoots.join(", ")}.`,
          invalid.length > 0 ? "" : null,
          invalid.length > 0 ? "Skipped invalid auto lines:" : null,
          invalid.length > 0 ? invalid.map((line) => `- ${line}`).join("\n") : null,
          discovered.unmatched.length > 0 ? "" : null,
          discovered.unmatched.length > 0 ? "Unmatched projects:" : null,
          discovered.unmatched.length > 0
            ? discovered.unmatched
                .map((project) => `- ${project.projectKey} -> ${project.repoUrl}`)
                .join("\n")
            : null,
          "",
          formatMappings(nextProjects),
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    if (parsed.action === "import") {
      const sharedMappings = await loadDispatchProjectMappings(sharedMappingPath).catch((error) => {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw error;
      });

      if (!sharedMappings || Object.keys(sharedMappings).length === 0) {
        return {
          text: [
            `No shared PREQ mappings found at ${sharedMappingPath}.`,
            "",
            formatUsage(projects),
          ].join("\n"),
        };
      }

      const imported = {};
      const skipped = [];
      for (const [projectKey, projectCwd] of Object.entries(sharedMappings)) {
        try {
          await ensureProjectCheckout(projectCwd);
          imported[projectKey] = projectCwd;
        } catch (error) {
          skipped.push(
            `- ${projectKey} -> ${projectCwd} (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }

      if (Object.keys(imported).length === 0) {
        return {
          text: [
            "Shared PREQ mappings were found, but none passed local validation.",
            skipped.length > 0 ? "" : null,
            skipped.length > 0 ? "Skipped invalid shared mappings:" : null,
            skipped.length > 0 ? skipped.join("\n") : null,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      const nextProjects = {
        ...projects,
        ...imported,
      };
      const nextConfig = updatePluginProjects(currentConfig, nextProjects);
      await api.runtime.config.writeConfigFile(nextConfig);

      return {
        text: [
          `Imported ${Object.keys(imported).length} PREQ project mapping${Object.keys(imported).length === 1 ? "" : "s"} from ${sharedMappingPath}.`,
          skipped.length > 0 ? "" : null,
          skipped.length > 0 ? "Skipped invalid shared mappings:" : null,
          skipped.length > 0 ? skipped.join("\n") : null,
          "",
          formatMappings(nextProjects),
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    if (!parsed.projectKey) {
      return { text: formatUsage(projects) };
    }

    if (parsed.action === "unset") {
      delete projects[parsed.projectKey];
      const nextConfig = updatePluginProjects(currentConfig, projects);
      await api.runtime.config.writeConfigFile(nextConfig);
      return {
        text: [
          `Removed PREQ project mapping for ${parsed.projectKey}.`,
          "",
          formatMappings(projects),
        ].join("\n"),
      };
    }

    if (!parsed.projectCwd || !parsed.projectCwd.startsWith("/")) {
      return {
        text: [
          "Path must be an absolute path.",
          "",
          formatUsage(projects),
        ].join("\n"),
      };
    }

    await ensureProjectCheckout(parsed.projectCwd);
    projects[parsed.projectKey] = parsed.projectCwd;
    const nextConfig = updatePluginProjects(currentConfig, projects);
    await api.runtime.config.writeConfigFile(nextConfig);

    return {
      text: [
        `Saved PREQ project mapping: ${parsed.projectKey} -> ${parsed.projectCwd}`,
        "",
        formatMappings(projects),
      ].join("\n"),
    };
  };
}
