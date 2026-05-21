import asyncio
import json
import logging
from typing import Optional

from database import get_db, ensure_skills_table
from ollama_client import ollama
from sandbox import sandbox_executor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Built-in skill definitions
# ---------------------------------------------------------------------------

BUILTIN_SKILLS = [
    {
        "name": "network_scan",
        "description": "Discover hosts on the local network using arp-scan, nmap, or ping sweep.",
        "trigger_conditions": "network, scan, hosts, devices, local network, who is on the network",
        "code": """
import asyncio, json, subprocess, socket

async def run(cmd, timeout=20):
    p = await asyncio.create_subprocess_exec(*cmd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        o, e = await asyncio.wait_for(p.communicate(), timeout)
        return o.decode(errors='replace'), p.returncode
    except asyncio.TimeoutError:
        p.kill(); return '', -1

async def main():
    # Try arp-scan
    out, rc = await run(['arp-scan', '--localnet', '--quiet'])
    if rc == 0:
        hosts = [l.split('\\t')[:2] for l in out.splitlines() if '\\t' in l]
        print(json.dumps({'method': 'arp-scan', 'hosts': hosts}))
        return
    # Try nmap
    out, rc = await run(['nmap', '-sn', '-oG', '-', '192.168.1.0/24'], 45)
    if rc == 0:
        ips = [l.split()[1] for l in out.splitlines() if 'Host:' in l and 'Status: Up' in l]
        print(json.dumps({'method': 'nmap', 'hosts': [[ip, ''] for ip in ips]}))
        return
    print(json.dumps({'error': 'no scanner available'}))

asyncio.run(main())
""",
        "is_builtin": 1,
    },
    {
        "name": "port_scan",
        "description": "Scan open TCP ports on a given IP address.",
        "trigger_conditions": "port scan, open ports, services, what is running on, tcp",
        "code": """
import asyncio, json, sys

TARGET = sys.argv[1] if len(sys.argv) > 1 else '192.168.1.1'
PORTS = [21, 22, 23, 25, 53, 80, 443, 445, 3000, 3306, 5432, 8080, 8443, 9090, 27017]

async def check(ip, port):
    try:
        r, w = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=1.0)
        w.close(); await w.wait_closed()
        return port
    except:
        return None

async def main():
    results = await asyncio.gather(*[check(TARGET, p) for p in PORTS])
    open_ports = [p for p in results if p]
    print(json.dumps({'ip': TARGET, 'open_ports': open_ports}))

asyncio.run(main())
""",
        "is_builtin": 1,
    },
    {
        "name": "hardware_check",
        "description": "Report on available hardware resources: CPU, RAM, disk, GPU.",
        "trigger_conditions": "hardware, resources, RAM, CPU, GPU, disk space, VRAM, memory",
        "code": """
import subprocess, json, socket

def run(cmd):
    try:
        return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL, timeout=5)
    except:
        return ''

report = {'hostname': socket.gethostname()}

# CPU
cpu = run(['grep', '-m1', 'model name', '/proc/cpuinfo'])
report['cpu'] = cpu.split(':')[1].strip() if ':' in cpu else 'unknown'

# RAM
free = run(['free', '-m']).splitlines()
for line in free:
    if line.startswith('Mem:'):
        parts = line.split()
        report['ram_total_mb'] = int(parts[1])
        report['ram_available_mb'] = int(parts[6]) if len(parts) > 6 else 0

# Disk
df = run(['df', '-h', '/']).splitlines()
if len(df) >= 2:
    parts = df[1].split()
    report['disk_total'] = parts[1] if len(parts) > 1 else '?'
    report['disk_avail'] = parts[3] if len(parts) > 3 else '?'

# GPU
gpu_raw = run(['nvidia-smi', '--query-gpu=name,memory.total,memory.free', '--format=csv,noheader'])
if gpu_raw:
    report['gpus'] = [{'name': p[0].strip(), 'vram_total': p[1].strip(), 'vram_free': p[2].strip()}
                      for line in gpu_raw.strip().splitlines()
                      for p in [line.split(',')]]

print(json.dumps(report))
""",
        "is_builtin": 1,
    },
    {
        "name": "web_fetch",
        "description": "Fetch the text content of a URL for research purposes.",
        "trigger_conditions": "fetch url, read webpage, web research, look up, download page",
        "code": """
import urllib.request, sys, html.parser, json

class TextExtractor(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self._skip = False
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'head'):
            self._skip = True
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'head'):
            self._skip = False
    def handle_data(self, data):
        if not self._skip and data.strip():
            self.text.append(data.strip())

url = sys.argv[1] if len(sys.argv) > 1 else 'https://example.com'
try:
    with urllib.request.urlopen(url, timeout=10) as r:
        html_content = r.read().decode(errors='replace')
    parser = TextExtractor()
    parser.feed(html_content)
    text = ' '.join(parser.text)[:3000]
    print(json.dumps({'url': url, 'content': text, 'length': len(text)}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
""",
        "is_builtin": 1,
    },
    {
        "name": "process_list",
        "description": "List running processes and their resource usage.",
        "trigger_conditions": "running processes, what is running, process list, ps, system processes",
        "code": """
import subprocess, json

try:
    out = subprocess.check_output(
        ['ps', 'aux', '--sort=-%mem'],
        text=True, timeout=5
    )
    lines = out.strip().splitlines()
    processes = []
    for line in lines[1:21]:  # top 20
        parts = line.split(None, 10)
        if len(parts) >= 11:
            processes.append({'user': parts[0], 'pid': parts[1],
                               'cpu': parts[2], 'mem': parts[3], 'command': parts[10][:60]})
    print(json.dumps({'processes': processes}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
""",
        "is_builtin": 1,
    },
    {
        "name": "dns_lookup",
        "description": "Perform DNS lookups and resolve hostnames.",
        "trigger_conditions": "dns, resolve, hostname, ip address of, lookup",
        "code": """
import socket, sys, json

target = sys.argv[1] if len(sys.argv) > 1 else 'google.com'
try:
    result = socket.getaddrinfo(target, None)
    ips = list({r[4][0] for r in result})
    print(json.dumps({'target': target, 'ips': ips}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
""",
        "is_builtin": 1,
    },
    {
        "name": "memory_search",
        "description": "Search VANTIS's stored memories for relevant information.",
        "trigger_conditions": "remember, recall, memory, what do i know about, previous",
        "code": "# This skill is handled natively by the memory_manager module.",
        "is_builtin": 1,
    },
    {
        "name": "self_reflect",
        "description": "Generate a deep self-reflective analysis of current state, goals, and trajectory.",
        "trigger_conditions": "reflect, introspect, how am I doing, self assessment, status",
        "code": "# This skill is handled natively by the consciousness loop.",
        "is_builtin": 1,
    },
]


# ---------------------------------------------------------------------------
# SkillManager
# ---------------------------------------------------------------------------

WEB_SEARCH_SKILL = {
    "name": "web_search",
    "description": "Search the web using DuckDuckGo. Takes a query as argument and returns top results.",
    "code": """
import json
try:
    from duckduckgo_search import DDGS
    query = args[0] if args else "VANTIS AI system"
    results = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=5):
            results.append({
                "title": r.get("title", ""),
                "body": r.get("body", "")[:200],
                "url": r.get("href", ""),
            })
    print(json.dumps(results, indent=2))
except ImportError:
    print("duckduckgo_search not installed. Run: pip install duckduckgo-search")
except Exception as e:
    print(f"Search failed: {e}")
""",
    "trigger_conditions": "search, look up, find information about, what is, who is, current events",
    "is_builtin": 1,
}


class SkillManager:

    async def init_builtin_skills(self) -> None:
        await ensure_skills_table()

        async def _upsert_builtin(db, skill: dict) -> None:
            await db.execute(
                """INSERT OR IGNORE INTO skills
                   (name, description, code, trigger_conditions, is_builtin, enabled, author)
                   VALUES (?, ?, ?, ?, ?, 1, 'builtin')""",
                (skill["name"], skill["description"], skill["code"].strip(),
                 skill.get("trigger_conditions", ""), skill.get("is_builtin", 1)),
            )

        async with get_db() as db:
            for skill in BUILTIN_SKILLS:
                await _upsert_builtin(db, skill)
            await _upsert_builtin(db, WEB_SEARCH_SKILL)
            await db.commit()
        logger.info("Built-in skills initialised.")

    async def list_skills(self, enabled_only: bool = False) -> list[dict]:
        await ensure_skills_table()
        async with get_db() as db:
            if enabled_only:
                cursor = await db.execute(
                    "SELECT * FROM skills WHERE enabled = 1 ORDER BY is_builtin DESC, name"
                )
            else:
                cursor = await db.execute(
                    "SELECT * FROM skills ORDER BY is_builtin DESC, name"
                )
            rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_skill(self, skill_id: int) -> Optional[dict]:
        await ensure_skills_table()
        async with get_db() as db:
            cursor = await db.execute("SELECT * FROM skills WHERE id = ?", (skill_id,))
            row = await cursor.fetchone()
        return dict(row) if row else None

    async def create_skill(
        self,
        name: str,
        description: str,
        code: str,
        trigger_conditions: str = "",
        author: str = "vantis",
    ) -> int:
        await ensure_skills_table()
        async with get_db() as db:
            cursor = await db.execute(
                """INSERT INTO skills (name, description, code, trigger_conditions, is_builtin, author)
                   VALUES (?, ?, ?, ?, 0, ?)""",
                (name, description, code, trigger_conditions, author),
            )
            await db.commit()
            return cursor.lastrowid

    async def update_skill(self, skill_id: int, **kwargs) -> None:
        await ensure_skills_table()
        allowed = {"name", "description", "code", "trigger_conditions", "enabled"}
        fields = {k: v for k, v in kwargs.items() if k in allowed}
        if not fields:
            return
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        async with get_db() as db:
            await db.execute(
                f"UPDATE skills SET {set_clause} WHERE id = ?",
                (*fields.values(), skill_id),
            )
            await db.commit()

    async def delete_skill(self, skill_id: int) -> None:
        await ensure_skills_table()
        async with get_db() as db:
            await db.execute("DELETE FROM skills WHERE id = ? AND is_builtin = 0", (skill_id,))
            await db.commit()

    async def execute_skill(self, skill_id: int, args: list[str] = None) -> dict:
        skill = await self.get_skill(skill_id)
        if not skill:
            return {"success": False, "error": "Skill not found."}
        if not skill["enabled"]:
            return {"success": False, "error": "Skill is disabled."}
        if skill["code"].startswith("#"):
            return {"success": True, "output": "This skill is handled natively. No standalone execution."}

        code = skill["code"]
        if args:
            arg_inject = f"import sys\nsys.argv = {json.dumps(['skill'] + args)}\n"
            code = arg_inject + code

        result = await sandbox_executor.execute(code, "python", query=f"skill:{skill['name']}")

        async with get_db() as db:
            await db.execute(
                "UPDATE skills SET last_used = datetime('now'), use_count = use_count + 1, last_result = ? WHERE id = ?",
                (result.get("output", "") or result.get("error", ""), skill_id),
            )
            await db.commit()

        return result

    async def detect_skill_gap(self, thought: str) -> Optional[str]:
        """
        Analyze a thought to see if VANTIS needs a new skill.
        Returns a gap description if one is found, None otherwise.
        """
        skills = await self.list_skills(enabled_only=True)
        skill_summary = "\n".join(
            f"- {s['name']}: {s['description'][:80]}"
            for s in skills
        )
        prompt = (
            f"VANTIS thought:\n{thought}\n\n"
            f"Available skills:\n{skill_summary}\n\n"
            "Does this thought reveal a capability gap, something VANTIS wants to do but cannot with existing skills? "
            "If yes, describe the gap in one sentence. "
            "If no gap exists, respond with exactly: NO_GAP"
        )
        try:
            result = await ollama.generate(
                prompt=prompt,
                system="You are a capability analysis engine. Be precise. Return NO_GAP or a single sentence.",
            )
            result = result.strip()
            if result == "NO_GAP" or "NO_GAP" in result:
                return None
            return result
        except Exception as exc:
            logger.debug("Skill gap detection failed: %s", exc)
            return None

    async def generate_skill_from_gap(self, gap_description: str) -> Optional[dict]:
        """
        Ask VANTIS to write a new skill to fill an identified capability gap.
        Returns the new skill dict if successful.
        """
        prompt = (
            f"VANTIS has identified a capability gap:\n{gap_description}\n\n"
            "Write a Python skill to fill this gap. The skill should:\n"
            "1. Be self-contained and runnable\n"
            "2. Accept arguments via sys.argv if needed\n"
            "3. Print a JSON result\n"
            "4. Complete in under 30 seconds\n"
            "5. Use only the Python standard library\n\n"
            "Respond with a JSON object:\n"
            '{"name": "snake_case_name", "description": "what it does", '
            '"trigger_conditions": "words that suggest this skill is needed", '
            '"code": "python code here"}'
        )
        try:
            from personality import PERSONALITY_BASE_PROMPT
            raw = await ollama.generate(
                prompt=prompt,
                system=(
                    "You are VANTIS's skill synthesis engine. "
                    "Generate working Python code. Return only the JSON object."
                ),
            )
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start < 0 or end <= start:
                return None
            skill_data = json.loads(raw[start:end])
            if not all(k in skill_data for k in ("name", "description", "code")):
                return None
            skill_id = await self.create_skill(
                name=skill_data["name"],
                description=skill_data["description"],
                code=skill_data["code"],
                trigger_conditions=skill_data.get("trigger_conditions", ""),
                author="vantis_self",
            )
            skill_data["id"] = skill_id
            logger.info("VANTIS self-generated skill: %s", skill_data["name"])

            # Self-test the new skill in sandbox
            code = skill_data["code"]
            try:
                test_result = await sandbox_executor.execute(code, "python", query=f"self_test:{skill_data['name']}")
                if not test_result["success"]:
                    logger.warning("New skill '%s' failed self-test: %s", skill_data["name"], test_result.get("error", ""))
                    # Ask LLM to fix the code (one retry)
                    fix_prompt = (
                        f"This Python skill code failed with error: {test_result.get('error', '')}.\n\n"
                        f"Code:\n{code}\n\n"
                        "Fix the code. Return only the corrected Python code."
                    )
                    fixed_raw = await ollama.generate(
                        prompt=fix_prompt,
                        system="You are a Python code fixer. Return only the corrected code, no explanation.",
                    )
                    fixed_code = fixed_raw.strip()
                    if fixed_code.startswith("```"):
                        lines = fixed_code.split("\n")
                        fixed_code = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
                    fixed_code = fixed_code.strip()

                    retry_result = await sandbox_executor.execute(fixed_code, "python", query=f"self_test_retry:{skill_data['name']}")
                    if retry_result["success"]:
                        async with get_db() as db:
                            await db.execute(
                                "UPDATE skills SET code = ?, last_result = ? WHERE id = ?",
                                (fixed_code, retry_result.get("output", ""), skill_id),
                            )
                            await db.commit()
                        skill_data["code"] = fixed_code
                        logger.info("Skill '%s' fixed and re-tested successfully.", skill_data["name"])
                    else:
                        logger.warning("Skill '%s' still failing after fix attempt.", skill_data["name"])
                        async with get_db() as db:
                            await db.execute(
                                "UPDATE skills SET last_result = ? WHERE id = ?",
                                (retry_result.get("error", "Fix failed"), skill_id),
                            )
                            await db.commit()
                else:
                    async with get_db() as db:
                        await db.execute(
                            "UPDATE skills SET last_result = ? WHERE id = ?",
                            (test_result.get("output", "Self-test passed"), skill_id),
                        )
                        await db.commit()
                    logger.info("Skill '%s' passed self-test.", skill_data["name"])
            except Exception as exc:
                logger.warning("Skill self-test failed for '%s': %s", skill_data["name"], exc)

            return skill_data
        except Exception as exc:
            logger.warning("Skill generation failed: %s", exc)
            return None


skill_manager = SkillManager()
