#!/usr/bin/env bun

/**
 * Extract Workspace ID and Project ID from Roxy Browser
 */

import { configure, getConsoleSink } from "@logtape/logtape";
import { getRoxyClient } from "../../src/services/browser";

await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    { category: ["roxy"], lowestLevel: "warning", sinks: ["console"] },
  ],
});

async function main() {
  try {
    const roxyClient = getRoxyClient();
    const response = await roxyClient.workspaceProject();

    if (response.code !== 0) {
      console.error("Failed to fetch workspaces:", response.msg);
      process.exit(1);
    }

    const workspaces = response.data.rows;

    if (!workspaces || workspaces.length === 0) {
      console.log("No workspaces found.");
      return;
    }

    const firstWorkspace = workspaces[0];
    if (!firstWorkspace) {
      console.log("No workspaces found.");
      return;
    }

    const firstProject = firstWorkspace.project_details?.[0];

    console.log(`WORKSPACE_ID=${firstWorkspace.id}`);
    if (firstProject) {
      console.log(`PROJECT_ID=${firstProject.projectId}`);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
