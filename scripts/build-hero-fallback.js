'use strict';
// Keep the existing command as an alias; mesh and still must share one source.
import('./build-faceted-globe.mjs').catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
