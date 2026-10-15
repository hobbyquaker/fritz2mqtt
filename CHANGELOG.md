# Changelog

## 1.1.5

### Fixed

- **The switches and binary sensors stayed unknown in Home Assistant** — Internet, the WLAN,
  answering machine and call deflection switches, Call and Ringing. Their status is a JSON boolean,
  and the default state template `{{ value_json.val }}` rendered it as `False` / `True`, which never
  matched `pl_on: 'true'` / `stat_on: 'true'`. Fixed in `mqtt-interfaces-core` 0.17.1, which this
  release brings in: a boolean renders as `true` / `false`. Found through lgtv2mqtt
  [#21](https://github.com/hobbyquaker/lgtv2mqtt/issues/21), reported and diagnosed by @daviddu26 —
  thank you!
- `mqtt-interfaces-core` 0.17.1 also brings 0.16 and 0.17 (an availability entry of the adapter's
  own status tree waits for its item's value).

## 1.1.4

### Fixed

- **Home Assistant refused every device this adapter published.** The availability entries of the
  discovery payload carried `avty_tpl`. Inside an entry of an `availability` list
  that key expands to `availability_template`, which Home Assistant's schema for such an entry does
  not allow (there the template is `val_tpl`), and the device payload is validated as a whole: HA
  logged "Invalid MQTT device discovery payload" through
  `homeassistant.components.mqtt.discovery` and created nothing of the device. Found on lgtv2mqtt
  ([#20](https://github.com/hobbyquaker/lgtv2mqtt/issues/20)), fixed in `mqtt-interfaces-core`
  0.15.2.
  **After updating**, clear the retained discovery messages once so nothing of the refused payloads
  is left behind (`mosquitto_sub -t 'homeassistant/device/#' -v` shows them; an empty retained
  message on such a topic removes it).
- The core moves from 0.8 to 0.15.2 with this release.

## 1.1.3

- mqtt-interfaces-core 0.8: the instance publishes `<name>/maintenance/stats` (memory, CPU share, event loop lag) every 60 s — `--stats-interval`, 0 = off; she shows it on the Instances tab.

## 1.1.1

- `mqttInterfaces.needs` uses the vocabulary the core documents now: `network` (was ["network-host"]) — shown as badges in she's catalog.
- Package description without the Home Assistant discovery clause (discovery is a given for adapters on the core).

## 1.1.0

### Added

- Answering machines (`X_AVM-DE_TAM`): `tam/running`, `tam/capacity`, per configured machine
  `tam/<n>/{enabled,name,messages,new_messages,last_message,message_list}`; `set/tam/<n>/enabled`;
  Home Assistant switch and new-message sensor per machine. Messages are re-read after every call.
  `--no-tam` to skip.
- Call deflections (`X_AVM-DE_OnTel GetDeflections`): `deflection/<id>/{enabled,details}`,
  `set/deflection/<id>/enabled`, a Home Assistant switch per deflection. `--no-deflections` to skip.
- `--calllist-max` also caps each answering machine's message list.

### Changed

- Home Assistant discovery is re-published once per poll at most (was up to three times at startup).
- The external IPv6 address is probed once (IGD `WANIPConn1`, then the TR-064 connection service)
  instead of every poll; boxes without the IGD tree log one `info` line.
- WLAN switch names carry the band (`WLAN <ssid> 2.4 GHz` / `5 GHz`) so two radios with one SSID
  can be told apart.
- Traffic rates are derived from the counter deltas when the box does not serve the IGD tree.

### Fixed

- `<name>/info` `version` was overwritten by the box firmware version (now `firmware`).
- The box's `DeviceLog` no longer floods the debug log.

## 1.0.0

First release. An MQTT interface for AVM FRITZ!Box routers on
[mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core) (mqtt-smarthome spec
2.x), like the author's other xyz2mqtt adapters. It replaces a Node-RED flow built on
node-red-contrib-fritz (see README "Migrating from node-red-contrib-fritz"). **Nothing has been
verified against a real FRITZ!Box yet** — the implementation follows AVM's TR-064 documentation
and is tested against a fake box; see README "Compatibility" and the roadmap.

### Added

- TR-064 client without dependencies (`node:http(s)`, Digest auth, SOAP, device description,
  IGD tree, session paths); username auto-detection when `--username` is not given.
- Status items: `device/*`, `dsl/*` (rates, noise margin, attenuation, power, error counters),
  `wan/*` (connection, external IPv4/IPv6, uptime, link, 64 bit byte counters and rates),
  `wlan/<n>/*`, `host_count`, `host/<key>/{present,details}`, `call/*` (call monitor),
  `event/call`, `calllist`.
- Commands: `set/wlan/<n>/enabled`, `set/wan/reconnect`, `set/device/reboot`,
  `set/calllist/refresh`, `set/host/<key>/wol`, `set/raw` (opt-in, any TR-064 action).
- Home Assistant discovery: the box as a device with sensors, WLAN switches, reconnect/reboot
  buttons; `--ha-hosts` adds a `device_tracker` per LAN host.
- systemd installer (`--install`), Docker image, `--config-schema`.
