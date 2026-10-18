import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceInputs,sha256} from './source-inputs.mjs';

const repository=fileURLToPath(new URL('../../..',import.meta.url));
const output=path.resolve(process.argv[2]||'desktop/artifacts/linux-ci');
const arch=process.argv[3];
if(process.platform!=='linux'||!['x64','arm64'].includes(arch)||process.arch!==arch)
  throw Error('Linux CI evidence requires the explicit matching Linux architecture');
const before=JSON.parse(await readFile(path.join(output,'source-inputs.json'),'utf8'));
const after=await sourceInputs(repository,true);
if(before.sourceTreeSha256!==after.sourceTreeSha256||before.sourceCommit!==after.sourceCommit)
  throw Error('Build source changed after CI input capture');
await mkdir(output,{recursive:true});
const sboms=[];
for(const workspace of ['frontend','desktop'])for(const scope of ['production','all']) {
  const result=spawnSync('npm',['sbom','--sbom-format','cyclonedx',...(scope==='production'?['--omit','dev']:[])],
    {cwd:path.join(repository,workspace),encoding:'utf8',maxBuffer:32*1024*1024});
  if(result.error||result.status!==0)throw Error('Cannot generate Linux dependency SBOM');
  const bom=JSON.parse(result.stdout);
  if(bom.bomFormat!=='CycloneDX')throw Error('Invalid SBOM');
  const filename=`${workspace}-${scope}.cdx.json`,bytes=JSON.stringify(bom,null,2)+'\n';
  await writeFile(path.join(output,filename),bytes,{flag:'wx'});
  sboms.push({file:filename,sha256:sha256(bytes)});
}
await writeFile(path.join(output,'build-inputs.json'),JSON.stringify({schemaVersion:1,platform:process.platform,
  arch,node:process.version,glibcBuildRuntime:process.report.getReport().header.glibcVersionRuntime,
  sourceCommit:after.sourceCommit,sourceTreeSha256:after.sourceTreeSha256,sourceDirty:false,
  collectedAt:new Date().toISOString(),runnerImage:process.env.ImageOS||null,
  runnerImageVersion:process.env.ImageVersion||null,githubRunId:process.env.GITHUB_RUN_ID||null,sboms,
  scope:'Native-architecture Linux job; package/static/component smoke does not imply the full desktop distro matrix, physical performance or X11/Wayland visual acceptance.'},null,2)+'\n',{flag:'wx'});
