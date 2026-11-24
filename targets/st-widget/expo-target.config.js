/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'st-widget',
  displayName: 'Trueline Screen Time',
  bundleIdentifier: '.st-widget',
  deploymentTarget: '17.4',
  frameworks: ['WidgetKit', 'SwiftUI'],
  // Only the app group: the widget reads a summary the app and its extensions write; it doesn't
  // use the Screen Time API itself, so it needs no Family Controls approval.
  entitlements: { 'com.apple.security.application-groups': ['group.com.exercisetracker.trueline'] },
};
