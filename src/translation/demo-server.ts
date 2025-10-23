#!/usr/bin/env ts-node

/**
 * Translation Layer Demo Server
 * Standalone server that demonstrates the translation capabilities
 */

import express from 'express';

import translationRouter from './engine/router.js';

const PORT = process.env.TRANSLATION_PORT ?? 4004;

const app = express();
app.use(express.json());

// Mount translation router
app.use('/', translationRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Translation server running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  GET  /health - Health check`);
  console.log(`  GET  /providers - List supported providers`);
  console.log(`  POST /translate - Translate request between providers`);
  console.log(`  POST /translate-response - Translate response between providers`);
  console.log(`  POST /compatibility - Check compatibility`);
  console.log(`  POST /:targetProvider/chat/completions - Universal endpoint`);
});

export default app;