#!/usr/bin/env bun

/**
 * Get detailed browser profile information
 */

import { getRoxyClient } from "../../src/services/browser";
import { WORKSPACE_ID } from "../../src/config";

async function main() {
  const profileId = process.argv[2];

  if (!profileId) {
    console.log("Usage: bun bin/roxy/profile-details.ts <profile-id>");
    process.exit(1);
  }

  const roxyClient = getRoxyClient();

  console.log("Fetching browser profile details...\n");

  const response = await roxyClient.browserDetail(WORKSPACE_ID, profileId);

  if (response.code !== 0) {
    console.error("Failed to fetch profile details:", response.msg);
    return;
  }

  const profile = response.data?.rows?.[0];

  if (!profile) {
    console.error("Profile not found");
    return;
  }

  console.log("Profile Details:");
  console.log(JSON.stringify(profile, null, 2));
}

main();
