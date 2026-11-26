# AleGamestation OS – Download-Fortschritt im Installer
#
# Anaconda lädt das System mit „ostree container image deploy“ – ohne Terminal gibt das keinen Fortschritt aus,
# im Installer steht minutenlang nur „Deployment startet …“. Dieses Modul hängt sich an die Aufgabe
# (DeployOSTreeTask) und meldet alle paar Sekunden „Lade AleGamestation OS: 2,3 von 7,9 GB (29 %)“:
#   - Gesamtgröße: Summe der Ebenen laut Registry-Manifest (ghcr.io, anonym)
#   - Fortschritt: empfangene Bytes aller Netzwerkkarten seit dem Start
# Wird über eine .pth-Datei beim Start jedes Python-Prozesses geladen, greift aber nur, wenn genau das
# Anaconda-Modul importiert wird. Jeder Fehler hier darf die Installation nie stören.
import importlib.abc
import importlib.util
import json
import os
import sys
import threading
import time
import urllib.request

TARGET = "pyanaconda.modules.payloads.payload.rpm_ostree.installation"


def _rx_bytes():
    total = 0
    try:
        for dev in os.listdir("/sys/class/net"):
            if dev == "lo":
                continue
            try:
                with open(f"/sys/class/net/{dev}/statistics/rx_bytes") as f:
                    total += int(f.read().strip() or 0)
            except OSError:
                pass
    except OSError:
        pass
    return total


def _image_size(ref):
    """Gesamtgröße (komprimiert) eines Abbilds in der Registry, z.B. ghcr.io/aleb-roni/alegamestation-os:stable"""
    try:
        ref = ref.split("://")[-1]
        host, _, rest = ref.partition("/")
        name, _, tag = rest.rpartition(":") if ":" in rest.split("/")[-1] else (rest, "", "latest")
        tag = tag or "latest"
        accept = ", ".join([
            "application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json"])
        token = ""
        if host == "ghcr.io":
            with urllib.request.urlopen(f"https://ghcr.io/token?scope=repository:{name}:pull", timeout=15) as r:
                token = json.load(r).get("token", "")

        def get(path):
            req = urllib.request.Request(f"https://{host}/v2/{name}/{path}", headers={"Accept": accept, **({"Authorization": f"Bearer {token}"} if token else {})})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)

        m = get(f"manifests/{tag}")
        if m.get("manifests"):  # Index → passendes Manifest für x86_64
            pick = next((x for x in m["manifests"] if (x.get("platform") or {}).get("architecture") in ("amd64", "x86_64")), m["manifests"][0])
            m = get(f"manifests/{pick['digest']}")
        return sum(int(l.get("size", 0)) for l in m.get("layers", []))
    except Exception:  # noqa: BLE001 – ohne Größe nur MB-Anzeige
        return 0


def _gb(b):
    return f"{b / 1073741824:.1f} GB".replace(".", ",") if b >= 1073741824 else f"{round(b / 1048576)} MB"


def _monitor(task, ref, stop):
    total = _image_size(ref)
    start = _rx_bytes()
    t0 = time.time()
    last_report = ""
    while not stop.wait(3):
        got = max(0, _rx_bytes() - start)
        if total:
            pct = min(99, int(got * 100 / total))
            speed = got / max(1, time.time() - t0)
            left = (total - got) / speed if speed > 0 and got < total else 0
            # Restzeit erst schätzen, wenn genug Daten da sind (mind. 100 MB und 20 s)
            eta = f" – noch ca. {int(left // 60) + 1} Min." if left > 60 and got > 100 * 1048576 and time.time() - t0 > 20 else ""
            msg = f"Lade AleGamestation OS: {_gb(got)} von {_gb(total)} ({pct} %){eta}" if got < total * 0.98 else "Richte AleGamestation OS ein … (entpacken, kann einige Minuten dauern)"
        else:
            msg = f"Lade AleGamestation OS: {_gb(got)} heruntergeladen"
        if msg != last_report:
            last_report = msg
            try:
                task.report_progress(msg)
            except Exception:  # noqa: BLE001
                pass


def _patch(module):
    cls = getattr(module, "DeployOSTreeTask", None)
    get_ref = getattr(module, "_get_ref", None)
    if not cls or getattr(cls, "_ags_patched", False):
        return
    orig_run = cls.run

    def run(self, *args, **kwargs):
        stop = threading.Event()
        try:
            data = getattr(self, "_data", None)
            if data is not None and data.is_container():
                ref = get_ref(data) if get_ref else ""
                threading.Thread(target=_monitor, args=(self, ref, stop), daemon=True).start()
        except Exception:  # noqa: BLE001
            pass
        try:
            return orig_run(self, *args, **kwargs)
        finally:
            stop.set()

    cls.run = run
    cls._ags_patched = True


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name != TARGET:
            return None
        sys.meta_path.remove(self)
        try:
            spec = importlib.util.find_spec(name)
        finally:
            sys.meta_path.insert(0, self)
        if not spec or not spec.loader:
            return spec
        orig_exec = spec.loader.exec_module

        def exec_module(module):
            orig_exec(module)
            try:
                _patch(module)
            except Exception:  # noqa: BLE001
                pass

        spec.loader.exec_module = exec_module
        return spec


def install():
    if os.environ.get("AGS_NO_PROGRESS_PATCH"):
        return
    if not any(isinstance(f, _Finder) for f in sys.meta_path):
        sys.meta_path.insert(0, _Finder())
