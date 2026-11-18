/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'shield-action',
  name: 'st-shield-action',
  displayName: 'Trueline Blocked Screen Actions',
  bundleIdentifier: '.st-shield-action',
  deploymentTarget: '17.4',
  frameworks: ['ManagedSettings', 'FamilyControls', 'DeviceActivity', 'UserNotifications'],
  entitlements: require('../entitlements'),
};
