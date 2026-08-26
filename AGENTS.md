# Agent instructions — fritz2mqtt

## What this is

fritz2mqtt is an MQTT interface ("bridge"/"adapter") for AVM FRITZ!Box routers: DSL line status,
internet connection and traffic, WLANs (switchable), LAN hosts (presence), the call monitor
(realtime call events) and the call list are published to an MQTT broker. It talks TR-064
(SOAP over HTTP with Digest auth, port 49000/49443), the UPnP IGD tree for the 64 bit traffic
counters, and the call monitor's plain TCP stream on port 1012.

It follows the [mqtt-smarthome](https://github.com/mqtt-smarthome/mqtt-smarthome) architecture
and is built on [mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core)
(`../mqtt-interfaces-core` when checked out next to this repo — generic fixes go there; its README
is the complete guide to building an adapter). Consistency with the core's conventions and with
unifi2mqtt / lgtv2mqtt / cul2mqtt is a hard requirement. ROADMAP.md lists what is planned and,
above all, what still needs verification on real boxes — **nothing has been run against a
FRITZ!Box yet**, only against a fake one that speaks the documented protocol.

## MQTT conventions (mqtt-smarthome)

Topic structure is `<name>/<function>/<item>`, `<name>` = `--name` (default `fritz`):

- `<name>/connected` — retained `0` (LWT) / `1` (broker only) / `2` (broker + box: the last poll
  succeeded).
- `<name>/status/<item>` — retained `{val, ts, lc}` (plain with `--no-json-payloads`). Item
  groups: `device/*`, `dsl/*`, `wan/*` (incl. `wan/link/*` and the traffic counters/rates),
  `wlan/<n>/*`, `host_count[/active]`, `host/<key>/{present,details}`, `call/*`, `calllist`.
  `event/call` is an **event** (not retained).
- `<name>/set/wlan/<n>/enabled`, `set/wan/reconnect`, `set/device/reboot`,
  `set/calllist/refresh`, `set/host/<key>/wol`, `set/raw` (opt-in `--raw-set`) — the commands.
- `<name>/raw` — the answer to a `set/raw` action (not retained).
- `<name>/info`, `<name>/maintenance/set/{loglevel,restart}` — from the core.

`<key>` of a host is its `topicKey()`-sanitised hostname (whitespace, `/`, `+`, `#` → `_`) or
mac (`--host-key`). Renaming items is a breaking change — document in CHANGELOG (migration
table) and README.

## Code layout (ES modules, node >= 20.19)

- `index.js` — `createAdapter()` from the core plus the box part: service detection
  (`detectServices()`: which of dsl / wan(ppp|ip) / traffic(igd|tr064) / wlan / hosts /
  calllist the box offers, username auto-detection), the poll loop (`--poll-interval`, 10 s
  retry while disconnected), the traffic loop (`--traffic-interval`), the call list refresh
  (after every call, on `set/calllist/refresh`), `apply()` (publishes the model's change lists,
  debounces discovery), `handleSet`, shutdown. `optional()` wraps every non-essential action:
  failures are `debug`, missing rights (fault 606) `warn` once.
- `lib/tr064.js` — `Tr064Client`: `node:http(s)` with an injectable `request` transport,
  Digest auth (challenge cached, `nc` incremented, so the box is never flooded with
  unauthenticated requests), SOAP envelope/response, fault → `Tr064Error {status, code,
service, action}`, device descriptions (`tr64desc.xml` + optional `igddesc.xml`, services
  keyed by serviceType, IGD ones flagged `igd` and called without auth), `get()` for session
  paths, `lastUsername()`. Service names are short (`DeviceInfo:1`, `igd:WANCommonInterfaceConfig:1`).
- `lib/xml.js` — the tiny XML reader (elements, text, CDATA, comments; no attributes, no
  namespaces). Enough for everything the box sends; not a general parser.
- `lib/model.js` — `FritzState`: the pure box model. Feed `applyDevice()`, `applyDsl()`,
  `applyLink()`, `applyWan()`, `applyTraffic()`, `applyWlans()`, `applyHosts()`, `applyCall()`,
  `applyCallList()`; get `{changes, clear, discovery}` back. Only changed values are reported
  (JSON compare per item). Unit conversions (0.1 dB → dB) and item names live here only.
- `lib/lists.js` — parsers for the call list and host list XML documents, `listPath()`.
- `lib/callmonitor.js` — `parseLine()` (pure) and `CallMonitor` (TCP 1012, reconnect, keepalive).
- `lib/hadiscovery.js` — `discoveryModel()`: the box as one HA device (+ one device per host
  with `--ha-hosts`) via the core's `entity()`.
- `lib/install.js` — the core installer (`createInstaller`) wired to fritz2mqtt.
- `config.js` — adapter options on top of the core's `parseConfig()`; exports `OPTIONS`, `check`
  and the parsed config (camelCased).
- `test/` — node:test unit tests, no network: `test/fixtures/*.xml` are hand-written after AVM's
  documentation (not captured from a box).
- `deploy.sh [user@host]` — dev deploy by tarball; same script as unifi2mqtt, keep in sync.

## Style & practices

- Plain JavaScript, ES modules, no build step. 4-space indentation, semicolons, prettier (120 cols).
- Keep dependencies minimal: `mqtt-interfaces-core` — that is all. No `fritzbox`/`tr-064`/
  `@seydx/fritzbox` (CJS, unmaintained, `request`/`got` based), no XML library.
- Never make default config values point at personal infrastructure (`fritz.box` is AVM's).
- Log at `debug` with the `fritz >` / `fritz <` / `callmonitor <` prefixes for raw exchanges; an
  unreachable box is `warn` once, then `debug` until the message changes.
- Breaking changes to topics, payloads or options must be called out in CHANGELOG + README.

## Running

```
node index.js -a fritz.box --username fritz2mqtt --password … -u mqtt://broker -v debug
```

Lint: `npm run lint` (eslint + prettier check), `npm run format` to fix. Tests: `npm test`.
CI runs both on Node 20/22/24. `node index.js --config-schema` must print valid JSON.

## Known weak spots (be careful around these)

- **Unverified protocol details** — see ROADMAP.md "Verification on real boxes". Do not "fix"
  action or argument names from memory; AVM's per-service PDFs
  (https://fritz.com/service/schnittstellen/) and a debug log from a real box are the sources.
- Rights: `DeviceInfo GetInfo`, `WANDSLInterfaceConfig GetInfo`, `WANPPPConnection GetInfo`
  need a user with "FRITZ!Box settings"; without them the adapter falls back to what it can
  read (`X_AVM-DE_GetDSLInfo`, the description's model name) and warns once per action.
- The IGD tree (`igddesc.xml`, 64 bit counters and rates) only exists when "transmit status
  information over UPnP" is enabled on the box; otherwise the TR-064 32 bit counters are used
  and there are no rates.
- The call monitor must be enabled once by dialling `#96*5*`; until then port 1012 refuses
  connections and the monitor retries every 10 s (warn once).
- Host keys depend on `--host-key`; a host whose name changes moves to a new topic and the old
  topics are cleared. HA ids are mac-based and therefore stable across renames.
