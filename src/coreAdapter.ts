/**
 * The only module in this repo that imports the vendored @dualtran/core
 * (see scripts/sync-core.mjs). Kept separate so the unit suite never needs the
 * tarball — only this file and the integration suite touch the real core.
 */
import * as core from "dualtran";

export const coreNamespace: any = core;
