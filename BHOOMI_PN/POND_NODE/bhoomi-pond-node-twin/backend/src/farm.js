// The gateway (layer 2) and cloud (layer 3) of the AgriMesh framework, shared with the browser.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const GW = require('../../shared/farm/gateway.cjs');
export const CLOUD = require('../../shared/farm/cloud.cjs');
export const I18N = require('../../shared/farm/i18n.cjs');
