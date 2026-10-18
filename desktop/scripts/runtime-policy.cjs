// Ship the audited JavaScript fallback on both architectures. ssh2's optional
// native accelerators are unnecessary for installer control traffic.
module.exports = {
  runtimePackages: ["ws", "ssh2", "asn1", "bcrypt-pbkdf", "safer-buffer", "tweetnacl"],
  excludedOptionalPackages: ["cpu-features", "nan", "buildcheck"],
  packageExclusions: [
    "!node_modules/cpu-features/**/*",
    "!node_modules/nan/**/*",
    "!node_modules/buildcheck/**/*",
    "!node_modules/**/*.node",
    "!node_modules/ssh2/test/**/*",
    "!node_modules/ssh2/examples/**/*",
    "!node_modules/ssh2/util/**/*",
    "!node_modules/ssh2/lib/protocol/crypto/src/**/*",
    "!node_modules/ssh2/lib/protocol/crypto/build/**/*",
    "!node_modules/ssh2/lib/protocol/crypto/binding.gyp",
  ],
};
