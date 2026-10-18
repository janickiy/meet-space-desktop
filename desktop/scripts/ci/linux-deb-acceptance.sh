#!/usr/bin/env bash
# Run only on a disposable Linux VM/hosted runner, as the ordinary desktop user.
# It refuses an existing MeetSpace package/path and never edits user defaults.
set -euo pipefail
if [[ $# != 3 || "$3" != --disposable ]]; then
  echo 'Usage: linux-deb-acceptance.sh absolute.deb absolute-evidence-dir --disposable' >&2
  exit 1
fi
[[ $(id -u) != 0 && "$1" = /* && "$2" = /* ]]
package=$(realpath -- "$1")
evidence=$2
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
desktop=$(cd -- "$script_dir/../.." && pwd)
name=$(dpkg-deb --field "$package" Package)
version=$(dpkg-deb --field "$package" Version)
[[ "$name" == meetspace-desktop-test ]]
[[ $(dpkg-deb --field "$package" Architecture) == "$(dpkg --print-architecture)" ]]
if dpkg-query -W -f='${Status}' "$name" 2>/dev/null | rg -q 'install ok installed'; then
  echo 'Existing MeetSpace test package: use a clean disposable VM.' >&2
  exit 1
fi
[[ ! -e '/opt/meetspace-desktop-test' && ! -L '/opt/meetspace-desktop-test' ]]
[[ ! -e '/usr/share/applications/com.janickiy.meetspace.desktop.test.desktop' && ! -L '/usr/share/applications/com.janickiy.meetspace.desktop.test.desktop' ]]
mkdir -p -- "$evidence"
[[ ! -e "$evidence/deb-lifecycle.json" ]]
owned=$(mktemp -d "$HOME/.meetspace-package-acceptance-XXXXXX")
fixture=$(mktemp -d)
installed=0
cleanup() {
  rc=$?
  # Never uninstall a package that was present before this run. On failure,
  # retain the owned profile/package for inspection rather than hiding evidence.
  if [[ $rc == 0 && $installed == 0 ]]; then rm -rf -- "$owned" "$fixture"; fi
  return "$rc"
}
trap cleanup EXIT
dpkg-deb --raw-extract "$package" "$fixture/baseline"
baseline="${version}~stage06fixture"
dpkg --compare-versions "$baseline" lt "$version"
sed -i "s/^Version: .*/Version: $baseline/" "$fixture/baseline/DEBIAN/control"
dpkg-deb --build --root-owner-group -Zgzip -z1 "$fixture/baseline" "$fixture/baseline.deb" > "$evidence/baseline-build.log"
printf '%s\n' 'Owned lower-version control fixture; application payload is identical to the candidate, not a historical product release.' > "$evidence/baseline-scope.txt"
sudo -n /usr/bin/apt-get install --assume-yes --no-install-recommends "$fixture/baseline.deb" > "$evidence/install.log" 2>&1
installed=1
[[ $(dpkg-query -W -f='${Version}' "$name") == "$baseline" ]]
node "$desktop/tests/linux-installed-package-runner.cjs" '/opt/meetspace-desktop-test/meetspace-test' deb "$evidence/baseline-smoke.json" "$owned" > "$evidence/baseline-smoke.log" 2>&1
profile=$(node -e 'const fs=require("node:fs"),path=require("node:path");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).packagedRuntime.userData;if(!p.startsWith(process.argv[2]+"/config/"))throw Error("Profile escaped own fixture");console.log(p)' "$evidence/baseline-smoke.json" "$owned")
printf '%s\n' 'Owned stage06 profile preservation marker' > "$profile/stage06-sentinel.txt"
before=$(sha256sum "$profile/stage06-sentinel.txt" | cut -d' ' -f1)
sudo -n /usr/bin/apt-get install --assume-yes --no-install-recommends "$package" > "$evidence/upgrade.log" 2>&1
[[ $(dpkg-query -W -f='${Version}' "$name") == "$version" ]]
[[ $(sha256sum "$profile/stage06-sentinel.txt" | cut -d' ' -f1) == "$before" ]]
node "$desktop/tests/linux-installed-package-runner.cjs" '/opt/meetspace-desktop-test/meetspace-test' deb "$evidence/candidate-smoke.json" "$owned" > "$evidence/candidate-smoke.log" 2>&1
sudo -n /usr/bin/apt-get install --assume-yes --no-install-recommends --reinstall "$package" > "$evidence/reinstall.log" 2>&1
[[ $(sha256sum "$profile/stage06-sentinel.txt" | cut -d' ' -f1) == "$before" ]]
sudo -n /usr/bin/apt-get remove --assume-yes "$name" > "$evidence/remove.log" 2>&1
installed=0
[[ ! -e '/opt/meetspace-desktop-test/meetspace-test' ]]
[[ ! -e '/usr/share/applications/com.janickiy.meetspace.desktop.test.desktop' ]]
[[ $(sha256sum "$profile/stage06-sentinel.txt" | cut -d' ' -f1) == "$before" ]]
node --input-type=module - "$package" "$evidence" "$baseline" "$version" <<'NODE'
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [file,out,baseline,candidate]=process.argv.slice(2);
await writeFile(out+'/deb-lifecycle.json',JSON.stringify({schemaVersion:1,result:'PASS',collectedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,artifact:file,sha256:createHash('sha256').update(await readFile(file)).digest('hex'),baseline,candidate,baselineScope:'Controlled lower package version of the same payload, not historical application/data migration.',baselineFixtureCompression:'gzip level 1; candidate package compression unchanged',checks:{install:true,packageManagerUpgrade:true,reinstall:true,remove:true,ownedProfilePreserved:true},runtimeReports:['baseline-smoke.json','candidate-smoke.json'],actualLoginTested:false,fullDesktopMatrixAccepted:false},null,2)+'\n',{flag:'wx'});
NODE
echo 'DEB lifecycle PASS'
