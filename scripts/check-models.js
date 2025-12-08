#!/usr/bin/env node

// Check available models from Deepinfra via ToolBridge

import http from "http";

const options = {
  hostname: "localhost",
  port: 3100,
  path: "/v1/models",
  method: "GET",
  headers: {
    Authorization: "Bearer test-key",
  },
};

process.stdout.write("🔍 Checking available models...\n");

const req = http.request(options, (res) => {
  process.stdout.write(`Response Status: ${res.statusCode}\n`);

  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    try {
      const response = JSON.parse(data);
      process.stdout.write(`Available models:\n${JSON.stringify(response, null, 2)}\n`);
    } catch (_err) {
      process.stdout.write(`Raw response: ${data}\n`);
    }
  });
});

req.on("error", (err) => {
  process.stderr.write(`Request failed: ${err && err.message ? err.message : String(err)}\n`);
});

req.end();
