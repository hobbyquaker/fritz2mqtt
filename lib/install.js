/**
 * --install / --uninstall: systemd template service fritz2mqtt@<name>, one instance per FRITZ!Box
 * (mqtt-interfaces-core installer): /etc/fritz2mqtt/<name>.env, /var/lib/fritz2mqtt/<name>/,
 * system user fritz2mqtt, optional shared /etc/mqtt-interfaces/broker.env.
 */

import {createInstaller} from 'mqtt-interfaces-core';

export const SERVICE = 'fritz2mqtt';
export const ENV_PREFIX = 'FRITZ2MQTT';

const installer = createInstaller({
    service: SERVICE,
    envPrefix: ENV_PREFIX,
    description: `${SERVICE} %i - AVM FRITZ!Box to MQTT bridge`,
    documentation: 'https://github.com/hobbyquaker/fritz2mqtt',
});

export const {unitFile, envFile, installService, uninstallService, handle} = installer;
export {envVarName, instanceName} from 'mqtt-interfaces-core';
