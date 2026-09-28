"""Embed local configuration and HTML without exposing credentials in compiler flags."""
import json
from pathlib import Path
Import("env")
root = Path(env.subst("$PROJECT_DIR"))
config = root / ".env"
if not config.exists():
    raise RuntimeError("Copia .env.example a .env y configura las credenciales.")
values = {}
for number, raw in enumerate(config.read_text().splitlines(), 1):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    key, sep, value = line.partition("=")
    if not sep:
        raise RuntimeError(f"Formato inválido en .env, línea {number}")
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    values[key.strip()] = value
for key in ("WIFI_SSID", "WIFI_PASSWORD", "AP_SSID", "AP_PASSWORD"):
    if not values.get(key):
        raise RuntimeError(f"Falta {key} en .env")
for key in ("WIFI_SSID", "AP_SSID"):
    if len(values[key].encode()) > 32:
        raise RuntimeError(f"{key} supera 32 bytes")
if not 8 <= len(values["AP_PASSWORD"].encode()) <= 63:
    raise RuntimeError("AP_PASSWORD debe tener entre 8 y 63 bytes")
for key in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_NAME", "ALERT_EMAIL_TO"):
    if not values.get(key) or any(c in values[key] for c in "\r\n"):
        raise RuntimeError(f"Configuración SMTP inválida: {key}")
if values.get("SMTP_PORT") != "465" or values.get("SMTP_SECURITY") != "TLS":
    raise RuntimeError("Este firmware usa SMTP TLS en puerto 465")
for key in ("SMTP_USER", "ALERT_EMAIL_TO"):
    if "@" not in values[key] or any(c in values[key] for c in '<> ,;'):
        raise RuntimeError(f"Correo inválido: {key}")
try:
    alert_cooldown_seconds = int(values.get("ALERT_EMAIL_COOLDOWN_SECONDS", "30"))
except ValueError as error:
    raise RuntimeError("ALERT_EMAIL_COOLDOWN_SECONDS debe ser un número entero") from error
if not 10 <= alert_cooldown_seconds <= 3600:
    raise RuntimeError("ALERT_EMAIL_COOLDOWN_SECONDS debe estar entre 10 y 3600")
generated = Path(env.subst("$BUILD_DIR")) / "generated"
generated.mkdir(parents=True, exist_ok=True)
contents = "#pragma once\n"
for key in ("WIFI_SSID", "WIFI_PASSWORD", "AP_SSID", "AP_PASSWORD", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_NAME", "ALERT_EMAIL_TO"):
    contents += f"static const char {key}[] = {json.dumps(values[key], ensure_ascii=True)};\n"
contents += f"static const uint32_t ALERT_EMAIL_COOLDOWN_MS = {alert_cooldown_seconds * 1000}UL;\n"
roots = (root / "certs/google-roots.pem").read_text()
contents += 'static const char SMTP_CA[] PROGMEM = R"CERT(' + roots + ')CERT";\n'
html = (root / "web/index.html").read_text()
contents += 'static const char INDEX_HTML[] PROGMEM = R"VIGIAHTML(' + html + ')VIGIAHTML";\n'
target = generated / "config.h"
if not target.exists() or target.read_text() != contents:
    target.write_text(contents)
    target.chmod(0o600)
env.Append(CPPPATH=[str(generated)])
