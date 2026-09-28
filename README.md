# Vigía · ESP32

Firmware Arduino para la placa ESP32 clásica de 30 pines conectada por CP2102. Detectado por USB: ESP32-D0WD-V3, revisión 3.1, flash de 4 MB. Perfil PlatformIO `esp32dev`.

## Configuración

Las credenciales locales están en `.env`; `.env.example` es una plantilla sin la clave real. El archivo `.env` y los artefactos `.pio/` están excluidos de Git. El script `scripts/configure.py` genera un encabezado privado durante la compilación. El firmware contiene las credenciales: no compartas los binarios generados. Cambiar `.env` requiere volver a compilar y cargar.

- `WIFI_SSID` y `WIFI_PASSWORD`: red de internet de 2.4 GHz.
- `AP_SSID` y `AP_PASSWORD`: red propia del ESP32 (clave de 8 a 63 bytes).

## Abrir y cargar

```sh
cd ~/DEVELOPMENT/vigia_proyect
code .
pio run
pio run --target upload --upload-port /dev/cu.usbserial-0001
pio device monitor --port /dev/cu.usbserial-0001 --baud 115200
```

El puerto puede cambiar; consulta `pio device list`. Cierra el monitor serie antes de cargar. Si la conexión de carga falla, mantén BOOT durante “Connecting” y suéltalo al comenzar la escritura.

## Página web

Conéctate a la red propia configurada en `.env` y abre http://192.168.4.1 . También puedes entrar desde la misma red doméstica a la IP que aparece por serie o a http://vigia.local cuando el dispositivo admite mDNS.

`web/index.html` se integra en el firmware; no necesita un servidor externo ni archivos adicionales en flash. Muestra conexión Wi-Fi, direcciones IP, clientes, tiempo encendido y hora de Bolivia, y consulta la API cada segundo.

El ESP32 funciona en modo AP+STA: ofrece su red mientras se conecta al router. La red propia da acceso al panel y a la API; no actúa como repetidor ni comparte internet con los clientes. Si el router falla, el punto de acceso sigue disponible y la conexión se reintenta. El panel de solo lectura es accesible por ambas interfaces, sin un inicio de sesión adicional a la contraseña Wi-Fi.

## Servicios

- `GET /`: página HTML.
- `GET /api/status`: estado JSON sin contraseñas.
- `GET /api/time`: hora UTC Unix y estado de sincronización; responde 503 hasta tener hora y 200 después.
- Rutas inexistentes: 404 JSON.

El firmware consume el servicio de hora de internet mediante NTP (`pool.ntp.org` / `time.google.com`). No bloquea el servidor esperando Wi-Fi. La hora sincronizada indica que se logró acceder al servicio; no prueba que internet siga disponible en cada instante. La conexión permite añadir otros servicios según las necesidades futuras de Vigía.

## Verificación en la placa (27 de septiembre de 2026)

- Compilación y carga USB completadas; esptool verificó la escritura en flash.
- Arranque del punto de acceso `Vigia-ESP32` en `192.168.4.1` confirmado por serie.
- Conexión al router confirmada; IP asignada: `192.168.0.62` (puede cambiar por DHCP).
- Sincronización NTP por internet confirmada por serie.
- El Mac estaba en `192.168.26.x`; las peticiones HTTP desde esa red agotaron el tiempo de espera. La respuesta HTTP desde un cliente en la misma red queda pendiente de verificar.


## Sensor PIR y alertas

Sensor de las fotos: módulo compatible con HC-SR501 (PIR de movimiento, no presencia inmóvil). Desconecta USB antes de cablear. Alimentación del sensor a 5 V; su salida digital nominal de 3.3 V va al GPIO, nunca conectes 5 V a un GPIO.

| Sensor | ESP32 |
|---|---|
| VCC | VIN (5 V del USB; comprobar tensión si hay duda en esta placa genérica) |
| OUT | D27 / GPIO27 |
| GND | GND |

En IMG_2549, mirando la cara de componentes con los potenciómetros arriba y los tres pines abajo, la distribución habitual de este módulo es VCC izquierda, OUT centro y GND derecha. Verifica las marcas +/OUT/− o VCC/OUT/GND antes de energizar: no confundas esa vista con la cara de la lente. No necesitas las resistencias de la foto para esta conexión; GPIO27 lleva pulldown interno. No conectes una resistencia entre VIN y D27.

Alcance nominal máximo de esta familia: aproximadamente 700 cm, campo de visión hasta 120°; no mide distancia ni ángulo. Temperatura, lente, orientación y movimiento afectan al alcance real.

En IMG_2550, el potenciómetro marcado 501 (junto al jumper) ajusta sensibilidad; el marcado 105 ajusta retardo. Lleva sensibilidad al extremo de mayor alcance mediante pruebas caminando transversalmente a 300, 500 y 700 cm. Hay variantes con sentido de ajuste diferente: SunFounder describe aumento horario y Joy-IT antihorario; no fuerces el tope. Para pruebas, lleva el retardo al mínimo (normalmente antihorario). Coloca el jumper en H, uniendo el central y el lado rotulado H para redisparo. Conserva la lente y evita sol directo, calefactores y corrientes de aire caliente.

Tras alimentar, espera 60 segundos de estabilización. Se registran inicio, sensor listo, movimiento/alerta y señal baja/fin de alerta. Una señal alta mantenida genera un solo inicio de alerta; cuando baja se registra el fin. No representa cantidad de personas ni ausencia de personas cuando baja. Las alertas son visuales en la web, sin sirena; el inicio también puede enviar un correo.

`GET /api/events` devuelve los últimos 100 eventos en orden reciente, guardados en RAM; se pierden al reiniciar. La marca de tiempo usa NTP cuando está disponible y segundos de encendido cuando no lo está. El software no puede distinguir un sensor desconectado de una entrada permanentemente baja.

Pruebas de lógica: `c++ tests/motion_test.cpp -o /tmp/vigia-motion-test && /tmp/vigia-motion-test`. Verifican estabilización, señal mantenida, filtro de 100 ms, fin de alerta y desbordamiento del temporizador. Compilación y carga USB verificadas. Falta probar detecciones reales con el cableado conectado.

Fuentes:
- https://joy-it.net/en/products/SEN-HC-SR501
- https://joy-it.net/files/files/Produkte/SEN-HC-SR501/SEN-HC-SR501_Manual_2024-04-16.pdf
- https://docs.sunfounder.com/projects/umsk/en/latest/01_components_basic/12-component_pir_motion.html


## Alertas Gmail

Remitente y credenciales se configuran en `.env` (no se imprimen ni se sirven por HTTP). Nombre visible: vigiacorp. Destinatario fijo configurado: josecamperomorales@gmail.com. Se usa `smtp.gmail.com:465` con TLS implícito, certificado verificado contra las raíces de Google en `certs/google-roots.pem` (origen https://pki.goog/roots.pem). Requiere hora NTP válida.

Cada inicio de movimiento puede generar un correo. Hay un intervalo mínimo configurable con `ALERT_EMAIL_COOLDOWN_SECONDS`, actualmente de 10 segundos, reiniciado si se reinicia la placa. Durante el intervalo, las detecciones siguen registrándose pero sus correos se omiten; no se envía un resumen posterior. El envío corre en una tarea independiente para mantener el sensor y la web activos. Espera hasta 60 segundos a que haya red y hora; realiza un intento SMTP y registra el resultado. No hay reintentos automáticos para evitar duplicados si Gmail aceptó un mensaje pero se perdió la confirmación. Los trabajos pendientes están en RAM y se pierden al reiniciar.

El panel diferencia correo en cola, aceptación por Gmail, error, omisión por intervalo y resultado incierto. Aceptado por Gmail no confirma entrega a la bandeja principal. Por USB, enviar la letra mayúscula `T` genera un correo claramente marcado como prueba y no consume el intervalo de las alertas reales. No existe un endpoint web público que permita disparar correos arbitrarios.

Logo y favicon SVG están integrados en el HTML sin servicios externos. SMTP usa WiFiClientSecure y mbedTLS incluidos con Arduino-ESP32, sin dependencias de correo adicionales.

Prueba SMTP en hardware: el ESP32 envió por TLS el mensaje `[Vigia] Prueba de correo ESP32` al destinatario configurado y recibió aceptación SMTP de Gmail (evento 5). Esto valida red, certificado, autenticación y aceptación del mensaje; la llegada a la bandeja de entrada debe confirmarse en el correo del destinatario.

Corrección posterior: el intervalo de alertas se redujo de 300 a 30 segundos y los correos de diagnóstico dejaron de consumir ese intervalo. Se verificaron dos envíos consecutivos desde el ESP32; Gmail aceptó ambos. Una nueva alerta real requiere que el PIR primero vuelva a nivel bajo y después detecte otro movimiento. El firmware no repite correos mientras la misma señal permanezca activa.

Formato actual del correo: mensaje multipart con versión HTML y texto alternativo, asunto UTF-8 y diseño adaptable. Muestra el timestamp del evento en hora de Bolivia con precisión de segundos (`BOT`, UTC−04:00), marca ISO 8601, tiempo encendido, dispositivo e IP local. El intervalo actual de alertas reales es de 10 segundos. El formato visual fue cargado en el ESP32 y Gmail aceptó el correo de prueba.

## Panel en Vercel y datos en Supabase

La carpeta `public/` contiene el panel de internet. El navegador inicia sesión contra funciones de Vercel en `api/`; esas funciones consultan Supabase con una clave privada que nunca llega al navegador ni al ESP32. El dispositivo se autentica con una clave exclusiva y envía un latido cada 15 segundos, además del inicio y fin de cada movimiento. El panel consulta cada 15 segundos y considera al monitor desconectado cuando pasan más de 45 segundos sin latido.

### 1. Crear la base en Supabase

1. Crea un proyecto en https://database.new y espera a que termine su preparación.
2. Abre **SQL Editor**, crea una consulta y pega el contenido completo de `supabase/migrations/001_initial.sql`; pulsa **Run** una vez.
3. En **Table Editor** deben aparecer `dashboard_users`, `devices`, `device_config` y `motion_events`.
4. En **Project Settings → API** copia **Project URL** y una **Secret key** (`sb_secret_...`). Si tu proyecto todavía usa claves heredadas, sirve la clave `service_role`. Nunca uses o publiques esta clave en el ESP32, el HTML o GitHub.

La migración activa RLS y bloquea el acceso directo de `anon` y `authenticated`. Crea el usuario inicial `admin` con contraseña `admin`, el dispositivo `vigia-esp32-01` y su configuración. El inicio de sesión es deliberadamente sencillo y no usa Supabase Auth/OAuth. Para cambiar de inmediato la contraseña inicial, ejecuta en SQL Editor:

```sql
update public.dashboard_users
set password_hash = extensions.crypt('UNA_CLAVE_NUEVA', extensions.gen_salt('bf', 12))
where username = 'admin';
```

### 2. Generar secretos

Ejecuta dos veces este comando y guarda resultados diferentes:

```sh
openssl rand -hex 32
```

Uno será `SESSION_SECRET`, que firma la sesión web durante 8 horas. El otro será `DEVICE_API_KEY`, compartido únicamente entre Vercel y el `.env` privado del ESP32.

### 3. Importar GitHub en Vercel

1. En https://vercel.com/new elige **Import Git Repository** y selecciona `josecamperomorales-create/vigia_proyect`.
2. Usa **Framework Preset: Other** y **Root Directory: `.`**. No hace falta configurar Build Command ni Output Directory.
3. Antes de desplegar, agrega estas variables para **Production**:
   - `SUPABASE_URL`: Project URL copiada de Supabase.
   - `SUPABASE_SECRET_KEY`: Secret key o `service_role` de Supabase.
   - `SESSION_SECRET`: primer secreto generado.
   - `DEVICE_API_KEY`: segundo secreto generado.
4. Pulsa **Deploy**. Cada `git push` posterior a `main` generará un nuevo despliegue de producción.
5. Abre la URL `https://...vercel.app`, entra inicialmente con `admin` / `admin` y comprueba que aparece la configuración sembrada desde Supabase.

`.env.vercel.example` documenta los nombres y no contiene secretos reales. Si cambias variables en Vercel, debes volver a desplegar para que el nuevo despliegue las reciba.

### 4. Vincular y recargar el ESP32

Edita el `.env` local, que está ignorado por Git, y completa:

```dotenv
CLOUD_API_URL="https://TU-PROYECTO.vercel.app/api/device-ingest"
DEVICE_API_KEY="EL_MISMO_SECRETO_CONFIGURADO_EN_VERCEL"
DEVICE_ID="vigia-esp32-01"
FIRMWARE_VERSION="1.2.0"
```

Luego carga el dispositivo conectado:

```sh
cd ~/DEVELOPMENT/vigia_proyect
pio run --target upload --upload-port /dev/cu.usbserial-0001
pio device monitor --port /dev/cu.usbserial-0001 --baud 115200
```

En el monitor serie debe aparecer `Nube: heartbeat -> HTTP 202` dentro de los primeros 15 segundos. En la web el estado pasa a **Monitor activo**. Un movimiento agrega `motion_start` y, cuando la señal PIR baja, `motion_end`. Si se desconecta el ESP32, la web lo muestra sin conexión después de aproximadamente 45 segundos.

El envío usa HTTPS y valida el certificado TLS con las raíces de Google Trust Services y la raíz ISRG Root X1 de Let's Encrypt incluidas en el firmware. Los eventos pendientes viven en RAM: una caída de red o reinicio puede perder un evento, pero el próximo latido recupera el estado de conectividad.
