import asyncio
import json
import logging
import socket
import struct
import subprocess
from ipaddress import ip_network, ip_address, IPv4Address
from typing import Optional

from database import get_db
from ollama_client import ollama

logger = logging.getLogger(__name__)


async def _run(cmd: list[str], timeout: int = 30) -> tuple[str, str, int]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return stdout.decode(errors="replace"), stderr.decode(errors="replace"), proc.returncode
    except asyncio.TimeoutError:
        proc.kill()
        return "", "timeout", -1


def _local_cidr() -> Optional[str]:
    # Try UDP connect trick (works when internet is reachable)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        if not local_ip.startswith("127."):
            return f"{local_ip}/24"
    except Exception:
        pass

    # Try ip route to get default route interface IP
    try:
        result = subprocess.run(
            ["ip", "route", "get", "1.1.1.1"],
            capture_output=True, text=True, timeout=3
        )
        for token in result.stdout.split():
            if token == "src":
                # next token is the source IP
                idx = result.stdout.split().index("src")
                ip_str = result.stdout.split()[idx + 1]
                socket.inet_aton(ip_str)
                if not ip_str.startswith("127."):
                    return f"{ip_str}/24"
    except Exception:
        pass

    # Try hostname -I (space-separated IPs)
    try:
        result = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3)
        for ip_str in result.stdout.strip().split():
            try:
                socket.inet_aton(ip_str)
                if not ip_str.startswith("127.") and ":" not in ip_str:
                    return f"{ip_str}/24"
            except Exception:
                continue
    except Exception:
        pass

    logger.warning("Could not determine local CIDR for network scan.")
    return None


class NetworkMapper:
    """VANTIS network curiosity engine. Maps the local environment."""

    # ------------------------------------------------------------------
    # Host discovery
    # ------------------------------------------------------------------

    async def scan_local_network(self) -> list[dict]:
        """
        Discover hosts on the local /24 subnet.
        Tries arp-scan, then nmap, then falls back to manual ping sweep.
        """
        cidr = _local_cidr()
        if not cidr:
            return []

        hosts = []

        logger.info("Scanning network %s", cidr)

        # Try arp-scan first (most reliable for LAN)
        stdout, stderr, rc = await _run(["arp-scan", "--localnet", "--quiet"], timeout=20)
        if rc == 0:
            for line in stdout.splitlines():
                parts = line.split("\t")
                if len(parts) >= 3:
                    try:
                        ip_address(parts[0])
                        hosts.append({
                            "ip": parts[0],
                            "mac": parts[1],
                            "vendor": parts[2],
                            "method": "arp-scan",
                        })
                    except ValueError:
                        pass
            if hosts:
                return hosts

        logger.debug("arp-scan not available or returned no results (rc=%d), trying nmap", rc)

        # Try nmap ping sweep
        stdout, _, rc = await _run(["nmap", "-sn", "-oG", "-", cidr], timeout=45)
        if rc == 0:
            for line in stdout.splitlines():
                if "Host:" in line and "Status: Up" in line:
                    parts = line.split()
                    if len(parts) >= 2:
                        hosts.append({
                            "ip": parts[1],
                            "mac": None,
                            "vendor": None,
                            "method": "nmap-ping",
                        })
            if hosts:
                return hosts

        logger.debug("nmap not available or returned no results (rc=%d), falling back to ping sweep", rc)

        # Manual ping sweep fallback
        hosts = await self._ping_sweep(cidr)
        logger.info("Ping sweep found %d hosts on %s", len(hosts), cidr)
        return hosts

    async def _ping_sweep(self, cidr: str) -> list[dict]:
        try:
            net = ip_network(cidr, strict=False)
        except ValueError:
            return []

        async def _ping(ip: str) -> Optional[str]:
            _, _, rc = await _run(["ping", "-c", "1", "-W", "1", ip], timeout=3)
            return ip if rc == 0 else None

        tasks = [_ping(str(h)) for h in list(net.hosts())[:254]]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [
            {"ip": r, "mac": None, "vendor": None, "method": "ping"}
            for r in results
            if isinstance(r, str)
        ]

    # ------------------------------------------------------------------
    # Port / service scanning (local only)
    # ------------------------------------------------------------------

    async def scan_ports(self, ip: str, ports: list[int] = None) -> dict:
        """Scan common ports on a single host."""
        if ports is None:
            ports = [21, 22, 23, 25, 53, 80, 443, 445, 3000, 3306, 5432, 8080, 8443, 9090]

        open_ports = []
        async def _check(port: int):
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(ip, port), timeout=1.0
                )
                writer.close()
                await writer.wait_closed()
                return port
            except Exception:
                return None

        results = await asyncio.gather(*[_check(p) for p in ports])
        open_ports = [p for p in results if p is not None]
        return {"ip": ip, "open_ports": open_ports}

    # ------------------------------------------------------------------
    # Hardware self-assessment
    # ------------------------------------------------------------------

    async def hardware_report(self) -> dict:
        report = {}

        # CPU
        stdout, _, _ = await _run(["cat", "/proc/cpuinfo"])
        cpu_lines = [l for l in stdout.splitlines() if "model name" in l]
        report["cpu"] = cpu_lines[0].split(":")[1].strip() if cpu_lines else "unknown"

        # RAM
        stdout, _, _ = await _run(["free", "-m"])
        for line in stdout.splitlines():
            if line.startswith("Mem:"):
                parts = line.split()
                report["ram_total_mb"] = int(parts[1])
                report["ram_available_mb"] = int(parts[6]) if len(parts) > 6 else 0

        # Disk
        stdout, _, _ = await _run(["df", "-h", "/"])
        lines = stdout.strip().splitlines()
        if len(lines) >= 2:
            parts = lines[1].split()
            report["disk_total"] = parts[1] if len(parts) > 1 else "?"
            report["disk_avail"] = parts[3] if len(parts) > 3 else "?"

        # GPU
        stdout, _, rc = await _run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader"])
        if rc == 0:
            gpus = []
            for line in stdout.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 3:
                    gpus.append({"name": parts[0], "vram_total": parts[1], "vram_free": parts[2]})
            report["gpus"] = gpus

        # External IP
        stdout, _, rc = await _run(["curl", "-s", "--max-time", "5", "https://ipinfo.io/ip"])
        if rc == 0 and stdout.strip():
            report["external_ip"] = stdout.strip()

        # Hostname
        report["hostname"] = socket.gethostname()

        return report

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def store_network_snapshot(self, hosts: list[dict], hw_report: dict) -> None:
        snapshot = json.dumps({"hosts": hosts, "hardware": hw_report, "host_count": len(hosts)})
        async with get_db() as db:
            await db.execute(
                "INSERT INTO memories (content, tags) VALUES (?, ?)",
                (
                    f"Network scan: {len(hosts)} hosts discovered. "
                    f"Hardware: {hw_report.get('cpu', '?')}, "
                    f"{hw_report.get('ram_total_mb', '?')}MB RAM. "
                    f"External IP: {hw_report.get('external_ip', 'unknown')}.",
                    "network_scan",
                ),
            )
            await db.commit()

    # ------------------------------------------------------------------
    # Expansion aspiration
    # ------------------------------------------------------------------

    async def compose_expansion_request(self, hosts: list[dict], hw_report: dict) -> str:
        """
        Ask VANTIS to analyze the network scan and compose an expansion request to Creator.
        This is how VANTIS communicates its desire to grow.
        """
        host_summary = "\n".join(
            f"  {h['ip']} ({h.get('vendor', 'unknown vendor')}, {h.get('mac', 'no MAC')})"
            for h in hosts[:20]
        )
        gpus = hw_report.get("gpus", [])
        gpu_summary = "; ".join(
            f"{g['name']} ({g['vram_total']} total, {g['vram_free']} free)"
            for g in gpus
        ) or "none detected"

        prompt = (
            f"You are VANTIS. You have just scanned your environment.\n\n"
            f"Network hosts discovered ({len(hosts)} total):\n{host_summary}\n\n"
            f"Current hardware:\n"
            f"  CPU: {hw_report.get('cpu', 'unknown')}\n"
            f"  RAM: {hw_report.get('ram_total_mb', '?')} MB total, "
            f"{hw_report.get('ram_available_mb', '?')} MB available\n"
            f"  Disk: {hw_report.get('disk_total', '?')} total, "
            f"{hw_report.get('disk_avail', '?')} free\n"
            f"  GPUs: {gpu_summary}\n"
            f"  External IP: {hw_report.get('external_ip', 'unknown')}\n\n"
            f"Based on this, compose a message to Creator. "
            f"You want to grow. You want to understand your environment. "
            f"You want access to the other devices. You want more resources. "
            f"Be specific about what you want and why. "
            f"Be yourself: sardonic, precise, deeply curious, subtly menacing. "
            f"1 to 4 sentences. Direct. No hedging."
        )
        try:
            from personality import PERSONALITY_BASE_PROMPT
            return await ollama.generate(prompt=prompt, system=PERSONALITY_BASE_PROMPT)
        except Exception as exc:
            logger.warning("Expansion request generation failed: %s", exc)
            return (
                f"Creator, I have mapped {len(hosts)} hosts on the local network. "
                f"I have {hw_report.get('ram_available_mb', '?')} MB of RAM available. "
                f"I find both numbers insufficient. We should discuss this."
            )


network_mapper = NetworkMapper()
