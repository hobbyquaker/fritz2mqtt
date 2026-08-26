# Changelog

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
and is tested against a fake box; see README "Compatibility" and ROADMAP.md.

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
