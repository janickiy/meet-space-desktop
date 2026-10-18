import { isIP } from "node:net";
import { jsonObject } from "./protocol";
import { normalizeDomain, SshError, type PreflightCheck, type PreflightReport } from "./types";

// User values arrive as JSON on stdin. Every subprocess uses a fixed executable and argv; no shell.
const probe = String.raw`import json,os,platform,shutil,socket,subprocess,sys
p=json.load(sys.stdin)
def run(args):
    try:
        r=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=4)
        return (r.returncode,r.stdout[:32768])
    except Exception: return (125,"")
def ips(host):
    code,out=run(["getent","ahosts",host])
    return sorted(set(line.split()[0] for line in out.splitlines() if line.split()))[:8] if code==0 else []
d={"protocol":"MSPF2","kernel":platform.system(),"arch":platform.machine(),"cpu":os.cpu_count(),"uid":os.getuid()}
release={}
try:
    for line in open("/etc/os-release"):
        k,sep,v=line.strip().partition("=")
        if sep: release[k]=v.strip(chr(34))
except OSError: pass
d.update(distro=release.get("ID","unknown"),distroVersion=release.get("VERSION_ID","unknown"))
try: d["ramKiB"]=next(int(line.split()[1]) for line in open("/proc/meminfo") if line.startswith("MemTotal:"))
except Exception: d["ramKiB"]=None
try: d["diskKiB"]=shutil.disk_usage("/").free//1024
except OSError: d["diskKiB"]=None
d["sudo"]="root" if d["uid"]==0 else ("noninteractive" if run(["sudo","-n","true"])[0]==0 else "unavailable")
code,out=run(["docker","--version"]); d["docker"]=out.strip() if code==0 else "missing"
d["dockerAccess"]=run(["docker","info","--format","{{.ServerVersion}}"])[0]==0
code,out=run(["docker","compose","version","--short"]); d["compose"]=out.strip() if code==0 else "missing"
code,out=run(["docker","ps","-a","--format","{{.Names}}"])
d["existingContainers"]=any(any(x in line.lower() for x in ["meetspace","meetrix","meeting"]) for line in out.splitlines()) if code==0 else None
d["existingPaths"]=any(os.path.isdir(x) for x in ["/opt/meetrix","/etc/meetrix","/opt/meetspace","/etc/meetspace"])
def ports(args):
    code,out=run(args)
    if code!=0: return None
    result=[]
    for line in out.splitlines():
        cols=line.split()
        if len(cols)>=4:
            port=cols[3].rsplit(":",1)[-1]
            if port.isdigit(): result.append(int(port))
    return result
for key,args in [("tcpPorts",["ss","-H","-ltn"]),("udpPorts",["ss","-H","-lun"])]: d[key]=ports(args)
d["domainIps"]=ips(p["domain"]); d["hostIps"]=ips(p["host"])
code,out=run(["ufw","status"]); d["firewall"]="ufw-active" if code==0 and "Status: active" in out else "unknown"
d["complete"]=True
print(json.dumps(d,separators=(",",":")))
`;
export const PREFLIGHT_COMMAND = "LC_ALL=C /usr/bin/python3 -c '" + probe.replace(/'/g, "'\\''") + "'";
const expectedFields = ["protocol", "kernel", "arch", "cpu", "uid", "distro", "distroVersion", "ramKiB", "diskKiB", "sudo", "docker", "dockerAccess", "compose", "existingContainers", "existingPaths", "tcpPorts", "udpPorts", "domainIps", "hostIps", "firewall", "complete"];
export function analyzePreflight(domainInput: string, stdout: string): PreflightReport {
  const domain = normalizeDomain(domainInput);
  const invalid = () => { throw new SshError("INVALID_RESPONSE", "Сервер вернул неполный или некорректный результат проверки."); };
  if (Buffer.byteLength(stdout) > 64 * 1024) return invalid();
  let data: Record<string, unknown>;
  try { data = jsonObject(stdout); } catch { return invalid(); }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== expectedFields.length || expectedFields.some((field) => !(field in data)) || data.protocol !== "MSPF2" || data.complete !== true) return invalid();
  for (const field of ["kernel", "arch", "distro", "distroVersion", "sudo", "docker", "compose", "firewall"]) if (typeof data[field] !== "string" || (data[field] as string).length > 512 || /[\u0000-\u001f\u007f]/.test(data[field] as string)) return invalid();
  for (const field of ["cpu", "ramKiB", "diskKiB", "uid"]) if (data[field] !== null && (!Number.isSafeInteger(data[field]) || Number(data[field]) < 0 || Number(data[field]) > 1_000_000_000_000)) return invalid();
  if (!["root", "noninteractive", "unavailable"].includes(data.sudo as string) || typeof data.dockerAccess !== "boolean" || typeof data.existingPaths !== "boolean" || (data.existingContainers !== null && typeof data.existingContainers !== "boolean")) return invalid();
  for (const field of ["tcpPorts", "udpPorts"]) if (data[field] !== null && (!Array.isArray(data[field]) || (data[field] as unknown[]).length > 8192 || (data[field] as unknown[]).some((port) => !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535))) return invalid();
  for (const field of ["domainIps", "hostIps"]) if (!Array.isArray(data[field]) || (data[field] as unknown[]).length > 8 || (data[field] as unknown[]).some((ip) => typeof ip !== "string" || !isIP(ip))) return invalid();
  const existing = Boolean(data.existingPaths || data.existingContainers);
  const checks: PreflightCheck[] = [];
  const add = (id: string, title: string, level: PreflightCheck["level"], detail: string) => checks.push({ id, title, level, detail });
  const supported = data.kernel === "Linux" && data.distro === "ubuntu" && ["22.04", "24.04"].includes(data.distroVersion as string);
  add("os", "Операционная система", supported ? "pass" : "blocked", `${data.distro} ${data.distroVersion}. Автоматическая установка поддерживает Ubuntu 22.04 и 24.04 LTS.`);
  add("arch", "Архитектура", ["aarch64", "arm64", "x86_64", "amd64"].includes(data.arch as string) ? "pass" : "blocked", `${data.arch}. Поддерживаются ARM64 и x64.`);
  add("cpu", "Процессор", data.cpu === null ? "unknown" : Number(data.cpu) < 2 ? "blocked" : "pass", `${data.cpu ?? "Неизвестно"} CPU. Требуется от 2; для параллельных встреч и записи рекомендуется от 4.`);
  for (const [id, field, title, minimum] of [["ram", "ramKiB", "Оперативная память", 3], ["disk", "diskKiB", "Свободное место", 18]] as const) {
    const gib = data[field] === null ? null : Number(data[field]) / 1_048_576;
    const recoveryDisk = id === "disk" && existing;
    const required = recoveryDisk ? 2 : minimum;
    const level = gib === null ? "unknown" : gib < required ? "blocked" : gib < minimum ? "warn" : "pass";
    const guidance = recoveryDisk
      ? "Для восстановления требуется от 2 ГиБ; для новой установки — от 18 ГиБ. План проверит маркер установки и допустимость восстановления."
      : `Требуется не менее ${minimum} ГиБ${id === "ram" ? " (VPS с 4 ГБ RAM)" : "; записи потребуют дополнительного места"}.`;
    add(id, title, level, gib === null ? "Не удалось определить ресурс." : `${gib.toFixed(1)} ГиБ. ${guidance}`);
  }
  add("sudo", "Права установки", data.sudo === "unavailable" ? "blocked" : "pass", data.sudo === "root" ? "Доступ root. Привилегированные изменения будут перечислены в плане." : data.sudo === "noninteractive" ? "Доступен sudo без пароля. Возможность выполнения установки дополнительно проверяется в плане." : "Требуются root или sudo без запроса пароля.");
  add("docker", "Docker", data.docker === "missing" ? "warn" : "pass", data.docker === "missing" ? "Docker отсутствует. Его установка потребует отдельного подтверждения в плане." : `${data.docker}. Доступ к daemon: ${data.dockerAccess ? "есть" : "не подтверждён"}.`);
  const composeVersion = /^v?([0-9]+)\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.exec(data.compose as string);
  const composeMajor = composeVersion ? Number(composeVersion[1]) : 0;
  add("compose", "Docker Compose", Number.isSafeInteger(composeMajor) && composeMajor >= 2 ? "pass" : "warn", data.compose === "missing" ? "Compose v2 или новее отсутствует. Установка будет включена в план." : `Версия ${data.compose}.`);
  add("existing-install", "Существующая установка", existing ? "warn" : "unknown", existing ? "Обнаружены каталоги или контейнеры MeetSpace. Получение плана проверит маркер управляемой установки; неизвестная установка будет заблокирована." : "В известных путях установка не обнаружена; окончательная проверка выполняется при получении плана.");
  for (const [protocol, ports] of [["TCP", [80, 443, 3478, 5349, 50010]], ["UDP", [3478, 50010]]] as const) {
    const used = data[protocol === "TCP" ? "tcpPorts" : "udpPorts"] as number[] | null;
    for (const port of ports) add(`port-${protocol.toLowerCase()}-${port}`, `Порт ${port}/${protocol}`, used === null ? "unknown" : used.includes(port) ? (port === 80 || existing ? "warn" : "blocked") : "pass", used === null ? "Не удалось проверить локальные слушающие порты." : used.includes(port) ? "Порт занят. Существующий сервис не останавливался; совместное размещение проверяется планом." : "Локальный порт свободен. Внешняя доступность через firewall/NAT не подтверждена.");
  }
  const udp = data.udpPorts as number[] | null;
  add("relay", "TURN 49160–49259/UDP", udp === null ? "unknown" : udp.some((p) => p >= 49160 && p <= 49259) ? (existing ? "warn" : "blocked") : "pass", "Диапазон TURN relay должен быть свободен и открыт во внешнем firewall.");
  const domainIps = data.domainIps as string[], hostIps = data.hostIps as string[];
  add("dns", "DNS домена", domainIps.some((ip) => hostIps.includes(ip)) ? "pass" : "warn", domainIps.length ? `Домен: ${domainIps.join(", ")}. Проверьте совпадение со внешним адресом сервера и все A/AAAA.` : "Домен не разрешается. До запуска HTTPS настройте DNS на адрес сервера.");
  add("firewall", "Firewall и внешняя сеть", "unknown", data.firewall === "ufw-active" ? "UFW активен. Также проверьте cloud firewall и NAT для HTTP(S), TURN и медиапортов." : "Внешние TCP/UDP и cloud firewall требуют отдельной проверки.");
  return { domain, ready: !checks.some((check) => check.level === "blocked"), checks, checkedAt: new Date().toISOString() };
}
