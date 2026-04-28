// Babel config for the VSBS owner mobile app.
// Expo SDK 53 uses babel-preset-expo, which targets Hermes + the new
// React Native architecture. react-native-reanimated requires its own
// plugin to be the *last* entry in the plugins list.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"],
  };
};
