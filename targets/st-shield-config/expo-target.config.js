/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'shield-config',
  name: 'st-shield-config',
  displayName: 'Trueline Blocked Screen',
  bundleIdentifier: '.st-shield-config',
  deploymentTarget: '17.4',
  frameworks: ['ManagedSettings', 'ManagedSettingsUI', 'FamilyControls', 'DeviceActivity'],
  entitlements: require('../entitlements'),
};
