/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'device-activity-monitor',
  name: 'st-monitor',
  displayName: 'Trueline Screen Time',
  bundleIdentifier: '.st-monitor',
  deploymentTarget: '17.4',
  frameworks: ['DeviceActivity', 'ManagedSettings', 'FamilyControls'],
  entitlements: require('../entitlements'),
};
