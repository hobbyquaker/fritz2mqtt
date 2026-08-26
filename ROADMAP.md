# Roadmap — fritz2mqtt

## Done in 1.0.0

- Adapter on mqtt-interfaces-core 0.6: config (`--config-schema`, `FRITZ2MQTT_*`), MQTT,
  `{val, ts, lc}` payloads, `<name>/info`, maintenance topics, discovery publishing, installer,
  journald logging.
- Own TR-064 client on `node:http(s)` (`lib/tr064.js`): Digest auth, SOAP, device descriptions
  (TR-064 + IGD), faults, session paths, username auto-detection.
- Box model (`lib/model.js`): device, DSL, WAN link/connection/traffic, WLANs, hosts (presence
  with rename/removal handling, filter), call monitor state, call list — all pure and tested.
- Call monitor on TCP 1012 with reconnect; call list via `X_AVM-DE_OnTel GetCallList`.
- Home Assistant discovery: the box as one device (sensors, switches, buttons), optionally one
  `device_tracker` per LAN host.
- Replaces the author's Node-RED flow (node-red-contrib-fritz: `WANDSLInterfaceConfig GetInfo`,
  `GetTotalBytesSent/Received`, `WANPPPConnection GetInfo`, `GetCallList`).

## Done in 1.1.0

- Answering machines (`tam/*`, switch, message counts and list) and call deflections
  (`deflection/*`, switch) — from the documentation, not yet verified on a box.
- Derived traffic rates, IPv6 probe-once, WLAN band labels, discovery coalescing, log fixes
  from the first hardware run.

## Next steps

Agreed 2026-08-26; the first block needs someone at the box, the rest is code.

1. **At home — verify 1.1.0 on the 7590**, then tag `v1.1.0` (`git tag v1.1.0 && git push origin
v1.1.0` runs the release workflow):
   - deploy `master` (`npm run deploy`), check the `services:` line lists `tam`;
   - `tam/0/*` and `deflection/*` topics look right (see "Still unverified" → TAM / deflections);
     toggle `set/tam/0/enabled` and a deflection and watch the status follow;
   - dial `#96*5*` on a phone at the box, make a call, check `event/call` / `call/*`;
   - optionally enable "Statusinformationen über UPnP übertragen" → IGD tree: box-side
     `wan/rate_*`, `wan/external_ipv6`;
   - toggle a WLAN via `set/wlan/<n>/enabled`;
   - let it run a day for the Digest nonce lifetime.
2. **Smart home** (`X_AVM-DE_Homeauto:1`) — the next feature, only if DECT devices hang on the
   box; see Features.
3. Phonebook lookup for `event/call`, then the small items (global WLAN switch, `mark_read`,
   `--forget-after`).
4. Housekeeping: capture real fixtures from the 7590 (`scripts/dump.js`), deprecate the
   Node-RED flow.

## Open

### Verified on real boxes

FRITZ!Box 7590, FRITZ!OS 154.08.21, DSL/PPPoE, user with full rights (2026-08-26): Digest auth
on 49000, `Layer3Forwarding GetDefaultConnectionService` (`1.WANPPPConnection.1`), `DeviceInfo`,
`WANDSLInterfaceConfig GetInfo/GetStatisticsTotal` (tenths of dB confirmed), `GetCommonLinkProperties`,
`WANPPPConnection GetInfo`, `WLANConfiguration:1..3` (`X_AVM-DE_FrequencyBand` in GetInfo, guest
last with band `unknown`), `X_AVM-DE_GetHostListPath` (`/devicehostlist.lua?sid=…`, `InterfaceType`
`Ethernet` or empty), `GetCallList` (`NewCallListURL` is `http://<box>:49000/calllist.lua?sid=…`),
TR-064 `GetTotalBytesSent/Received` are 64 bit. Not on this box: the IGD tree (UPnP status off → 404) and therefore `X_AVM_DE_GetExternalIPv6Address` (not offered by the TR-064 connection service).

### Still unverified

- **Digest nonce lifetime**: whether the box answers `stale=true` at some point (we redo the
  challenge on any 401 once) — a long run will tell.
- **Username auto-detection** (`LANConfigSecurity X_AVM-DE_GetUserList`, `last_user="1"`) on
  boxes with several users; boxes without users (FRITZ!OS < 7.24).
- **Rights**: which actions really need "FRITZ!Box settings" and whether the 606 fault is what
  comes back; whether the `X_AVM-DE_GetDSLInfo` fallback really needs no auth.
- **IGD tree** with UPnP status enabled: `GetAddonInfos` field names
  (`NewX_AVM_DE_TotalBytesSent64`), `WANIPConn1 X_AVM_DE_GetExternalIPv6Address`, no-auth control
  URLs.
- **Call monitor** line formats on current FRITZ!OS (suppressed caller ids, the `CONNECT`
  extension field), keepalive behaviour — needs `#96*5*` dialled first.
- **WLAN** `SetEnable` and how long until `GetInfo` reflects it; `WLANConfiguration:4` boxes.
- Cable / fiber / LTE boxes (`--no-dsl`, `WANIPConnection`), `Layer3Forwarding` string on them.
- TLS on 49443 with the box's self-signed certificate (`--tls -k`).
- **TAM / deflections** (1.1.0): `GetList` `Display` semantics, `GetMessageList` `NewURL` and the
  message document's field names, `GetDeflections` list format and `Type`/`Mode` vocabulary,
  rights needed (documented: P).
- Host list size on large networks; whether the sid path expires (it is re-read every poll).

### Features

- **Smart home** (`X_AVM-DE_Homeauto:1 GetGenericDeviceInfos` / `SetSwitch`): FRITZ!DECT
  switches, thermostats and sensors as `smarthome/<ain>/*` items and HA devices. TR-064 exposes
  switch state, power, energy, temperature and thermostat status; set temperature needs the AHA
  HTTP interface.
- Answering machine: `set/tam/<n>/mark_read` (`MarkMessage`), incremental message fetch.
- Phonebook lookup for the call monitor (`GetPhonebook` → name of the caller in `event/call`).
- Per-host details from `X_AVM-DE_GetSpecificHostEntryByIP` (wan access, filter profile) and
  `set/host/<key>/wan_access` via `X_AVM-DE_HostFilter` — opt-in, it is parental control.
- Incremental call list fetch (`id` + `timestamp` parameters) instead of `max` entries.
- `WLANConfiguration X_AVM-DE_SetWLANGlobalEnable` as `set/wlan/enabled` (the WLAN button).
- Device log (`X_AVM-DE_GetDeviceLogPath`) as events.
- `--forget-after <days>`: clear the retained topics of hosts the box no longer lists.

### Housekeeping

- Fixtures captured from real boxes (`tr64desc.xml`, `igddesc.xml`, host list, call list) — a
  `scripts/dump.js` that prints the raw documents with secrets redacted would help.
- Deprecate the author's Node-RED flow; document the topic migration (README).
