const assert = require("node:assert/strict");
const test = require("node:test");
const { isSupportedMacOS } = require("../dist/platform/macos-version.js");

test("macOS minimum policy accepts product versions for both native architectures", () => {
  for (const arch of ["x64", "arm64"]) {
    for (const version of ["15.0", "15.7.1", "26.0", "27.2"])
      assert.equal(isSupportedMacOS(version, arch), true);
    for (const version of ["12.7.6", "13.0", "14.7.2", "", "unknown", "Sequoia", "15", "15.0 beta", "15.0\n", "15.0.0.1"])
      assert.equal(isSupportedMacOS(version, arch), false, version);
  }
  for (const arch of ["ia32", "arm", "unknown"])
    assert.equal(isSupportedMacOS("15.0", arch), false);
});
