// AM1 packet format: the parser lives in shared/protocol/am1.cjs so the browser and the backend use the same code.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AM1 = require('../../shared/protocol/am1.cjs');
export const { TEXT_KEYS, FIELD_INFO, parseAM1, formatAM1 } = AM1;
