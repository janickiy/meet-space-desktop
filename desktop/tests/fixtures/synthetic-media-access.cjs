// Explicit in-process seam for Chromium fake-device tests. Never packaged or
// selected through CLI/env; real hardware and production use system TCC.
module.exports.syntheticMediaAccess = Object.freeze({ check: () => true, ensure: async () => true });
module.exports.syntheticScreenAccess = Object.freeze({ canSelect: () => true });
