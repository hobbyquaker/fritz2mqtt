# fritz2mqtt

[![npm](https://img.shields.io/npm/v/fritz2mqtt.svg)](https://www.npmjs.com/package/fritz2mqtt)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> AVM FRITZ!Box to MQTT: DSL and internet status, traffic, WLAN, LAN hosts, calls

Connects to a FRITZ!Box over its TR-064 interface and bridges it to an MQTT broker, following the
[mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome) architecture. DSL line
parameters, the internet connection (external IP, uptime), 64 bit traffic counters and current
rates, WLANs (switchable), LAN host presence, realtime call events from the call monitor and the
call list are published as retained status topics; everything is announced to Home Assistant via
MQTT discovery.

**Status: 1.0.0 has been run against one box so far** (FRITZ!Box 7590, FRITZ!OS 154.08.21);
see [Compatibility](#compatibility) and please report what works and what does not on yours.

## Install

```
npm install -g fritz2mqtt
```

Requires Node.js ^20.19, ^22.12 or >= 24. fritz2mqtt is built on
[mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core) (mqtt-smarthome spec
2.x) like the author's other adapters.

On the box:

- **Home Network → Network → Network Settings → "Allow access for applications"** (TR-064) must
  be on. "Transmit status information over UPnP" adds the box's own rate measurement and the
  external IPv6 address.
- Create a **user** for fritz2mqtt (System → FRITZ!Box Users) with "FRITZ!Box settings" (needed
  for DSL/WAN details and the `set` topics) and, for the call list, "voice messages, faxes, …".
  Without `--username` the user the box's web interface used last is taken.
- For realtime call events dial `#96*5*` once on a phone connected to the box (enables the call
  monitor on port 1012; `#96*4*` disables it).

## Usage

```
fritz2mqtt --address fritz.box --username fritz2mqtt --password s3cret --mqtt-url mqtt://broker
```

| option                               | default            | description                                                                                         |
| ------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------- |
| `-a, --address`                      | `fritz.box`        | box address (hostname or ip, optionally with port)                                                  |
| `--username`                         | last user          | box user; needs "FRITZ!Box settings" for DSL/WAN details and the `set` topics                       |
| `--password`                         |                    | box password, required                                                                              |
| `--tls`                              | off                | TR-064 over https (port 49443) instead of http (49000)                                              |
| `-k, --insecure`                     | off                | with `--tls`: accept the box certificate without validation (self-signed)                           |
| `--poll-interval`                    | `60`               | seconds between polls of DSL, WAN, WLAN, device and host status (min 5)                             |
| `--traffic-interval`                 | `10`               | seconds between polls of the traffic counters and rates (`0` = off)                                 |
| `--dsl`                              | on                 | publish DSL line status; `--no-dsl` for cable, fiber and LTE boxes                                  |
| `--wlan`                             | on                 | publish WLAN status and accept `wlan/<n>/enabled` commands                                          |
| `--hosts`                            | on                 | publish LAN host presence                                                                           |
| `--host-key`                         | `name`             | how hosts are named in topics: `name` (hostname, else mac) or `mac`                                 |
| `--host-filter`                      | all                | only publish these hosts: mac addresses or hostnames, comma separated (counts still cover everyone) |
| `--ha-hosts`                         | off                | announce a `device_tracker` per host to Home Assistant                                              |
| `--callmonitor`                      | on                 | connect to the call monitor (port 1012) for realtime call events                                    |
| `--calllist`                         | on                 | publish the call list (refreshed after every call and on `set/calllist/refresh`)                    |
| `--calllist-max`                     | `20`               | number of calls in the call list                                                                    |
| `--calllist-days`                    | `0`                | only calls of the last n days (`0` = no limit)                                                      |
| `--raw-set`                          | off                | accept arbitrary TR-064 actions on `<name>/set/raw`                                                 |
| `-u, --mqtt-url`                     | `mqtt://localhost` | broker URL, see [MQTT.js](https://github.com/mqttjs/MQTT.js#connect-using-a-url)                    |
| `--mqtt-username`, `--mqtt-password` |                    | broker credentials                                                                                  |
| `--mqtt-tls-ca`                      |                    | CA certificate file for `mqtts://`                                                                  |
| `-n, --name`                         | `fritz`            | instance name, used as topic prefix                                                                 |
| `--json-payloads`                    | on                 | status as `{"val", "ts", "lc"}` JSON; `--no-json-payloads` for plain values                         |
| `--ha-discovery`                     | on                 | Home Assistant MQTT discovery (`--no-ha-discovery` disables and clears it)                          |
| `--ha-prefix`                        | `homeassistant`    | discovery prefix                                                                                    |
| `--maintenance`                      | on                 | accept `<name>/maintenance/set/{loglevel,restart}`; `--no-maintenance` disables                     |
| `-v, --verbosity`                    | `info`             | `error`, `warn`, `info`, `debug`                                                                    |
| `--install` / `--uninstall`          |                    | install/remove the systemd service `fritz2mqtt@<name>`                                              |
| `--config-schema`                    |                    | print the JSON Schema of all options and exit                                                       |

Every option can also be set via environment variable with the prefix `FRITZ2MQTT_`, e.g.
`FRITZ2MQTT_ADDRESS=192.168.178.1 FRITZ2MQTT_PASSWORD=… fritz2mqtt`; the broker settings fall
back to the unprefixed `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`.

### Run as a systemd service

```
sudo fritz2mqtt --install --name fritz -a 192.168.178.1 --username fritz2mqtt --password s3cret -u mqtt://192.168.178.2
```

`--install` creates a system user `fritz2mqtt`, writes the given options to
`/etc/fritz2mqtt/<name>.env` (`FRITZ2MQTT_*` variables, `0640 root:fritz2mqtt` — edit and
`systemctl restart fritz2mqtt@<name>` to change), installs the template unit
`/etc/systemd/system/fritz2mqtt@.service` and enables + starts `fritz2mqtt@<name>`. The instance
name is the `--name` option, i.e. the MQTT topic prefix. Broker settings shared by all
mqtt-interfaces adapters on the host can go to `/etc/mqtt-interfaces/broker.env` (`MQTT_URL`,
`MQTT_USERNAME`, `MQTT_PASSWORD`). Logs: `journalctl -u fritz2mqtt@<name> -f`.

Several boxes (a mesh repeater FRITZ!Box, a second site): run `--install` once per box with a
different `--name`. `sudo fritz2mqtt --uninstall --name <n>` removes one instance.
[she](https://github.com/hobbyquaker/she) can install, configure and update instances from its
Services page (config form from `--config-schema`, the password masked).

### Docker

```
docker run -d --name fritz2mqtt --restart unless-stopped \
  -e FRITZ2MQTT_ADDRESS=192.168.178.1 \
  -e FRITZ2MQTT_USERNAME=fritz2mqtt \
  -e FRITZ2MQTT_PASSWORD=s3cret \
  -e FRITZ2MQTT_MQTT_URL=mqtt://broker \
  ghcr.io/hobbyquaker/fritz2mqtt
```

## Topics

`<name>` defaults to `fritz`. Host names are used as topic levels after sanitising: whitespace,
`/`, `+` and `#` become `_`; duplicate names get a `_<last 4 mac digits>` suffix.

### `<name>/connected`

Retained. `0` = not connected to the broker (set via last will), `1` = connected to the broker
but not to the box (unreachable, wrong password, last poll failed), `2` = the box answers.

### `<name>/info` and `<name>/maintenance/set/…`

`<name>/info` (retained JSON) describes the running instance: package name and version,
mqtt-smarthome spec version, node version, host, pid, start time, box url, model, `firmware`,
wan connection type (`ppp`/`ip`), whether the call monitor is connected, the poll intervals.
`<name>/maintenance/set/loglevel` (`error|warn|info|debug`) changes the log level at runtime,
`<name>/maintenance/set/restart` exits cleanly so the service manager restarts the process;
`--no-maintenance` turns both off.

### `<name>/status/<item>`

Retained status reports (except events), published after every poll — only when the value
changed. Every status is `{"val": <value>, "ts": <ms received>, "lc": <ms last changed>}`; with
`--no-json-payloads` the plain value (objects as JSON).

**Box** (`DeviceInfo GetInfo`, every `--poll-interval`)

| item                      | type   | notes                         |
| ------------------------- | ------ | ----------------------------- |
| `device/model`            | string | `FRITZ!Box 7590`              |
| `device/software_version` | string | `154.07.57`                   |
| `device/hardware_version` | string |                               |
| `device/serial`           | string |                               |
| `device/uptime`           | int    | seconds since the box started |

**DSL** (`WANDSLInterfaceConfig GetInfo` + `GetStatisticsTotal`; `--no-dsl` to skip)

| item                                                       | type   | notes                                                        |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `dsl/status`                                               | string | `Up`, `Down`, `Initializing`, `Unavailable`                  |
| `dsl/enabled`                                              | bool   |                                                              |
| `dsl/data_path`                                            | string | `Fast` / `Interleaved`                                       |
| `dsl/downstream_curr_rate`, `dsl/upstream_curr_rate`       | int    | current sync rate, kbit/s                                    |
| `dsl/downstream_max_rate`, `dsl/upstream_max_rate`         | int    | attainable rate, kbit/s                                      |
| `dsl/downstream_noise_margin`, `dsl/upstream_noise_margin` | number | dB (the box reports tenths; converted)                       |
| `dsl/downstream_attenuation`, `dsl/upstream_attenuation`   | number | dB                                                           |
| `dsl/downstream_power`, `dsl/upstream_power`               | number | dBm                                                          |
| `dsl/atur_vendor`, `dsl/atur_country`                      | string |                                                              |
| `dsl/crc_errors`, `dsl/fec_errors`, `dsl/hec_errors`       | int    | totals since sync                                            |
| `dsl/errored_secs`, `dsl/severely_errored_secs`            | int    |                                                              |
| `dsl/link_retrain`                                         | int    |                                                              |
| `dsl/modulation`, `dsl/profile`                            | string | only with the low-privilege fallback (`X_AVM-DE_GetDSLInfo`) |

**Internet connection** (`WANPPPConnection`/`WANIPConnection GetInfo`, `WANCommonInterfaceConfig
GetCommonLinkProperties`)

| item                                                               | type        | notes                                                        |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------ |
| `wan/connected`                                                    | bool        | `status == Connected`                                        |
| `wan/status`                                                       | string      | `Connected`, `Connecting`, `Disconnected`, `Unconfigured`, … |
| `wan/type`                                                         | string      | `ppp` or `ip` (which connection service the box routes by)   |
| `wan/enabled`                                                      | bool        |                                                              |
| `wan/uptime`                                                       | int         | seconds since the connection came up                         |
| `wan/external_ip`                                                  | string      | IPv4                                                         |
| `wan/external_ipv6`, `wan/external_ipv6_prefix_length`             | string, int |                                                              |
| `wan/last_error`                                                   | string      | `ERROR_NONE`, …                                              |
| `wan/dns_servers`                                                  | string      | comma separated                                              |
| `wan/upstream_max_bitrate`, `wan/downstream_max_bitrate`           | int         | bit/s, from the connection service                           |
| `wan/access_type`                                                  | string      | `DSL`, `Ethernet`, `X_AVM-DE_Cable`, `X_AVM-DE_Fiber`, …     |
| `wan/link/status`                                                  | string      | physical link: `Up`, `Down`, …                               |
| `wan/link/downstream_max_bitrate`, `wan/link/upstream_max_bitrate` | int         | layer 1, bit/s                                               |

**Traffic** (every `--traffic-interval` seconds; `GetAddonInfos` from the UPnP IGD tree when the
box serves it, else the TR-064 `GetTotalBytesSent/Received` counters)

| item                                         | type | notes                                                                       |
| -------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `wan/bytes_sent`, `wan/bytes_received`       | int  | totals since the last reconnect (64 bit on current firmware)                |
| `wan/rate_up`, `wan/rate_down`               | int  | bytes/s — as the box measures them (IGD) or derived from the counter deltas |
| `wan/packet_rate_up`, `wan/packet_rate_down` | int  | packets/s (IGD only)                                                        |

**WLAN** (`WLANConfiguration:<n>`; `n` is the box's numbering: 1 = 2.4 GHz, then 5 GHz, the
guest network last)

| item                    | type   | notes                  |
| ----------------------- | ------ | ---------------------- |
| `wlan/<n>/enabled`      | bool   | settable               |
| `wlan/<n>/status`       | string | `Up`, `Disabled`       |
| `wlan/<n>/ssid`         | string |                        |
| `wlan/<n>/channel`      | int    |                        |
| `wlan/<n>/standard`     | string | `n`, `ac`, `ax`, `be`  |
| `wlan/<n>/band`         | string | `2400`, `5000`, `6000` |
| `wlan/<n>/guest`        | bool   |                        |
| `wlan/<n>/bssid`        | string |                        |
| `wlan/<n>/associations` | int    | connected clients      |

**Hosts** (`Hosts X_AVM-DE_GetHostListPath`, fallback `GetGenericHostEntry`; `--no-hosts` to skip)

| item                 | type   | notes                                                                                               |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `host_count`         | int    | hosts the box knows                                                                                 |
| `host_count/active`  | int    | hosts currently connected                                                                           |
| `host/<key>/present` | bool   | the box lists the host as active                                                                    |
| `host/<key>/details` | object | `{mac, name, ip, interface, speed, guest, wired}` — `interface` is `802.11`, `Ethernet`, `HomePlug` |

`<key>` is the hostname (`--host-key name`, default) or the mac address. A host the box forgets
gets its topics cleared; a renamed host moves to the new key. `--host-filter` limits the
per-host topics (the counts still cover every host).

**Calls** (call monitor on port 1012, realtime; `--no-callmonitor` to skip)

| item                 | type   | notes                                                                                                                                                                                    |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event/call`         | object | **not retained**: every call monitor line — `{type, id, ts, caller, callee, line}` (ring), `{…, extension}` (call), `{type: connect, extension, number}`, `{type: disconnect, duration}` |
| `call/ringing`       | bool   | an incoming call is ringing                                                                                                                                                              |
| `call/active`        | bool   | a call is connected                                                                                                                                                                      |
| `call/count`         | int    | calls in progress (ringing, dialing or connected)                                                                                                                                        |
| `call/calls`         | array  | the calls in progress: `{id, direction, state, number, own, extension, line, ts, connected}`                                                                                             |
| `call/last_incoming` | object | `{number, own, line, ts}` of the last incoming call (set when it rings)                                                                                                                  |
| `call/last_outgoing` | object | `{number, own, extension, line, ts}` of the last outgoing call                                                                                                                           |
| `call/last`          | object | the last ended call: `{id, direction, state: ended, number, own, line, ts, duration, ended, missed}`                                                                                     |

**Call list** (`X_AVM-DE_OnTel GetCallList`; refreshed a few seconds after every call and on
`set/calllist/refresh`; `--no-calllist` to skip)

| item       | type  | notes                                                                                                                                                                                                   |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calllist` | array | newest first, `--calllist-max` entries: `{id, type, number, name, own, device, port, ts, duration, path}`; `type` is `incoming`, `missed`, `outgoing`, `rejected`, `active_incoming`, `active_outgoing` |

### `<name>/set/<item>`

Change requests. Payload is a plain value or mqtt-smarthome style JSON (`{"val": true}`).

| topic                         | payload                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `<name>/set/wlan/<n>/enabled` | `true`/`false`, `1`/`0`, `on`/`off`                                                                      |
| `<name>/set/wan/reconnect`    | anything but `false` — drop and re-establish the internet connection (`ForceTermination`)                |
| `<name>/set/device/reboot`    | anything but `false` — reboot the box (`DeviceConfig Reboot`)                                            |
| `<name>/set/calllist/refresh` | anything — re-read the call list                                                                         |
| `<name>/set/host/<key>/wol`   | anything — Wake on LAN (`<key>` may also be a mac address)                                               |
| `<name>/set/raw`              | `{"service": "DeviceInfo:1", "action": "GetInfo", "arguments": {"NewIndex": 0}}` — with `--raw-set` only |

```
mosquitto_pub -t fritz/set/wlan/3/enabled -m false
mosquitto_pub -t fritz/set/wan/reconnect -m true
```

`set/raw` calls any TR-064 action (`service` is the short name `Hosts:1`, the full urn, or
`igd:WANCommonInterfaceConfig:1` for the IGD tree); the response is published on `<name>/raw`
(not retained) as `{service, action, result}` or `{service, action, error, code}`. It is off by
default — with it, whoever can publish to the broker can reconfigure the box.

The status is re-read from the box after a command (WLAN: 2 s later); a rejected command is
logged at `warn`.

## Home Assistant

MQTT discovery is on by default (HA ≥ 2024.11, device-based discovery). The box appears as one
device with the DSL line sensors (rates, noise margin, attenuation, error counters), the internet
connection (`connectivity` binary sensor, external IP, uptime), traffic counters (`data_size`,
`total_increasing`) and rates, one switch and one client count per WLAN, call sensors (ringing,
in call, last caller/callee), host counts, uptime and the `Reconnect` and `Reboot` buttons.
With `--ha-hosts` every LAN host is its own device with a `device_tracker`
(`source_type: router`, `home`/`not_home`) whose attributes are the host's details;
`--host-filter` limits them. Availability follows `<name>/connected`.

Host devices are identified by mac address (`fritz2mqtt_<name>_host_<mac>`), so renaming a host
keeps its HA history. `--no-ha-discovery` disables discovery and removes the announcements.

## Migrating from node-red-contrib-fritz

fritz2mqtt replaces the typical Node-RED flow of `fritzbox-in` nodes feeding an `mqtt out` node.
The generic `NewX` → `X` mapping becomes snake_case items in their own groups:

| node-red-contrib-fritz (typical flow)                                   | fritz2mqtt                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `WANDSLInterfaceConfig GetInfo` → `fritz/status/dsl/DownstreamCurrRate` | `fritz/status/dsl/downstream_curr_rate` (same for the other fields; noise margin, attenuation and power are now dB, not tenths) |
| `WANCommonInterfaceConfig GetTotalBytesSent` → `…/dsl/TotalBytesSent`   | `fritz/status/wan/bytes_sent` (64 bit; plus `wan/rate_up`)                                                                      |
| `WANCommonInterfaceConfig GetTotalBytesReceived`                        | `fritz/status/wan/bytes_received` (plus `wan/rate_down`)                                                                        |
| `WANPPPConnection GetInfo`                                              | `fritz/status/wan/*` (`connected`, `external_ip`, `uptime`, …)                                                                  |
| `fritzbox-calllist`                                                     | `fritz/status/calllist`, refreshed automatically                                                                                |
| `fritzbox-callmonitor`                                                  | `fritz/status/event/call` and `call/*`                                                                                          |
| any other `fritzbox-in` action                                          | `fritz/set/raw` → `fritz/raw` (with `--raw-set`)                                                                                |

Payloads are `{val, ts, lc}` JSON (`--no-json-payloads` for the plain values the flow published).

## Compatibility

Developed against AVM's TR-064 documentation (FRITZ!OS 7.x/8.x service descriptions) and a fake
box; first verified on a FRITZ!Box 7590 with FRITZ!OS 154.08.21 (DSL, PPPoE). What it expects:

- TR-064 enabled on the box, a user with "FRITZ!Box settings" for full status. With fewer rights
  the adapter still runs: actions the user may not call are logged once at `warn` and skipped,
  DSL falls back to the unauthenticated `X_AVM-DE_GetDSLInfo`.
- The IGD tree (`igddesc.xml`) for the box's own rate measurement and the external IPv6
  address — needs "Transmit status information over UPnP"; otherwise the TR-064 counters are
  used and the rates are derived from them.
- Cable, fiber and LTE boxes: `--no-dsl`; the WAN connection is `WANIPConnection`, detected via
  `Layer3Forwarding GetDefaultConnectionService`.
- FRITZ!Box repeaters/mesh clients offer fewer services; missing ones are simply not published
  (see the `services:` line in the log at startup).

Run with `-v debug` to see every exchange (`fritz >` / `fritz <`); please attach that to bug
reports, together with the box model and FRITZ!OS version.

## License

MIT © Sebastian Raff
