// Read-only Linux observations for test harnesses; never imported by the app.
const fs = require('node:fs');
function collectLinuxProcessMetrics(processes) {
  if (process.platform !== 'linux') return {status:'NOT_MEASURED',reason:'Linux procfs only'};
  const rows = [];
  for (const item of processes) {
    const pid = Number(item.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process ID');
    const row = {pid,type:item.type,errors:[]};
    const base = `/proc/${pid}`;
    try {
      const content=fs.readFileSync(`${base}/stat`,'utf8');
      const stat=content.slice(content.lastIndexOf(') ')+2).trim().split(/\s+/);
      row.startTicks=stat[19];row.cpuTicks={user:Number(stat[11]),system:Number(stat[12])};
    } catch(error) {row.errors.push({field:'stat',code:error.code});}
    try {
      const status=fs.readFileSync(`${base}/status`,'utf8');
      row.threads=Number(/^Threads:\s+(\d+)/m.exec(status)?.[1]);
      row.rssKiB=Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]);
    } catch(error) {row.errors.push({field:'status',code:error.code});}
    // Sandboxed non-dumpable renderer FD enumeration can legitimately be EACCES.
    // Preserve status/RSS/threads and never change sandbox/dumpability to read it.
    try {row.fdCount=fs.readdirSync(`${base}/fd`).length;}
    catch(error) {row.errors.push({field:'fd',code:error.code});}
    rows.push(row);
  }
  const sum = field => rows.reduce((total,row)=>total+(Number.isFinite(row[field])?row[field]:0),0);
  return {status:rows.every(row=>row.errors.length===0)?'MEASURED':'PARTIAL',source:'Linux procfs',processes:rows,
    totals:{fdCount:sum('fdCount'),threads:sum('threads'),rssKiB:sum('rssKiB')},
    coverage:{fdProcesses:rows.filter(row=>Number.isFinite(row.fdCount)).length,statusProcesses:rows.filter(row=>Number.isFinite(row.threads)).length,totalProcesses:rows.length},
    note:'RSS sums include shared pages per process; these are not unique-memory/PSS totals. No process environment read.'};
}
module.exports={collectLinuxProcessMetrics};
