const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LEGACY_INSTALLER_RELEASE_SHA256 } = require('../dist/ssh/protocol');

test('real Python plan entry reports PLAN_CHANGED for the old recipe and safely rediscovers only a valid old plan', () => {
  const root = path.join(__dirname, '../resources/server-installer');
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', String.raw`
import contextlib, copy, importlib.util, io, json, pathlib, sys, types
sys.dont_write_bytecode = True
# The source installer runs on Linux. This seam exercises only read-only plan
# logic; host probes and filesystem reads are supplied below on every test OS.
if sys.platform == "win32":
    sys.modules["fcntl"] = types.ModuleType("fcntl")
root = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("installer", root / "v1" / "runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
current = json.loads((root / "v1" / "release.json").read_text())
legacy = json.loads((root / "legacy" / sys.argv[2] / "release.json").read_text())
options = {"domain": "meet.example.com", "publicIpv4": "8.8.8.8", "acmeEmail": ""}
job = "e0b0d6f0-14f6-4c58-a674-9c9665465a62"
previous = {"commit": legacy["commit"], "releaseVersion": legacy["version"],
    "releaseSha256": runner.digest(runner.canonical(legacy)), "resourceProfile": "standard", "options": options}
previous["hash"] = runner.digest(runner.canonical(previous))
original_hash = previous["hash"]
marker = {"jobId": job, "commit": legacy["commit"], "domain": options["domain"],
    "releaseSha256": previous["releaseSha256"]}
runner.os.geteuid = lambda: 0
runner.managed_marker = lambda: copy.deepcopy(marker)
runner.job_directory = lambda value: pathlib.Path("/unused/read-only-fixture")
runner.read_json = lambda target: copy.deepcopy(previous)
runner.platform_facts = lambda: {"os": "ubuntu", "osVersion": "24.04", "arch": "amd64", "cpus": 4, "memoryKiB": 8 * 1024 ** 2}
runner.disk_free = lambda: 40 * 1024 ** 3
runner.docker_facts = lambda **kwargs: {"installed": True, "version": "29.0.0", "composeVersion": "2.0.0"}
runner.dns_check = lambda supplied: [supplied["publicIpv4"]]
def forbidden(*args, **kwargs):
    raise AssertionError("plan must not execute subprocesses or write host state")
runner.run = forbidden
runner.write_atomic = forbidden
def invoke(recipe):
    runner.load_bundle = lambda: (recipe, {})
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        runner.entry("plan", {"options": options})
    return json.loads(output.getvalue())
mismatch = invoke(current)
recovered = invoke(legacy)
previous["hash"] = "0" * 64
tampered = invoke(legacy)
print(json.dumps({"mismatch": mismatch, "recovered": recovered, "tampered": tampered,
    "originalHash": original_hash, "job": job}))
`, root, LEGACY_INSTALLER_RELEASE_SHA256], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.mismatch.ok, false);
  assert.equal(actual.mismatch.errorCode, 'PLAN_CHANGED');
  assert.equal(actual.recovered.ok, true);
  assert.equal(actual.recovered.result.existingJobId, actual.job);
  assert.equal(actual.recovered.result.existingPlanHash, actual.originalHash);
  assert.equal(actual.recovered.result.releaseSha256, LEGACY_INSTALLER_RELEASE_SHA256);
  assert.equal(actual.tampered.ok, false);
  assert.equal(actual.tampered.errorCode, 'PLAN_CHANGED');
});

test('bundled Python ready-image installer checks frozen releases, safe imports, recovery and UTC build metadata', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-B', path.join(__dirname, 'ssh-installer-prebuilt.py')],
    { encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
