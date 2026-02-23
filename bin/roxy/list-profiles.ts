#!/usr/bin/env bun

/**
 * List Roxy Browser Profiles
 */

import { getRoxyClient } from "../../src/services/browser";
import { WORKSPACE_ID } from "../../src/config";

async function main() {
  const roxyClient = getRoxyClient();

  console.log("Fetching browser profiles...\n");

  const response = await roxyClient.browserList(WORKSPACE_ID, {
    pageIndex: 1,
    pageSize: 50,
  });

  if (response.code !== 0) {
    console.error("Failed to fetch profiles:", response.msg);
    return;
  }

  const profiles = response.data?.rows || [];

  console.log(`Found ${profiles.length} browser profiles:\n`);

  profiles.forEach((profile, index) => {
    console.log(`${index + 1}. ${profile.windowName}`);
    console.log(`   ID: ${profile.dirId}`);
    console.log(`   OS: ${profile.os} ${profile.osVersion}`);
    console.log(`   Chrome: ${profile.coreVersion}`);
    console.log(`   Created: ${profile.createTime}`);
    console.log(`   Status: ${profile.openStatus ? "Open" : "Closed"}`);
    console.log();
  });
}

main();
