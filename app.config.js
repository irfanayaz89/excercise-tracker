/**
 * Screen Time on iPhone needs Apple's Family Controls capability, which only a
 * paid Apple Developer Program team can sign (free Personal teams can't, even
 * for debug builds). So it's opt-in: build with SCREEN_TIME=1 to add the
 * entitlements and the three Screen Time extensions (targets/). Without it the
 * app builds as before and hides the feature on iPhone. See docs/SCREEN_TIME_PLAN.md.
 */
const APP_GROUP = 'group.com.exercisetracker.trueline';

module.exports = ({ config }) => {
  if (process.env.SCREEN_TIME !== '1') return config;
  return {
    ...config,
    ios: {
      ...config.ios,
      entitlements: {
        ...config.ios?.entitlements,
        'com.apple.developer.family-controls': true,
        'com.apple.security.application-groups': [APP_GROUP],
      },
      infoPlist: { ...config.ios?.infoPlist, TruelineScreenTime: true },
    },
    plugins: [...(config.plugins ?? []), '@bacons/apple-targets'],
  };
};
