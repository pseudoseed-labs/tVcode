import type { ConfigContext, ExpoConfig } from "expo/config";

const BUNDLE_IDENTIFIER = process.env.T3_TV_BUNDLE_ID ?? "com.t3tools.t3code.tv";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "T3 Code",
  slug: "t3code-tv",
  version: "0.0.1",
  scheme: "t3code-tv",
  userInterfaceStyle: "dark",
  backgroundColor: "#0a0a0a",
  experiments: {
    // On by default in workspaces; its scan maps `react-native` to apps/mobile's
    // copy instead of the react-native-tvos alias this app depends on.
    autolinkingModuleResolution: false,
  },
  ios: {
    bundleIdentifier: BUNDLE_IDENTIFIER,
    ...(process.env.T3_TV_BUILD_NUMBER ? { buildNumber: process.env.T3_TV_BUILD_NUMBER } : {}),
    ...(process.env.T3_TV_TEAM_ID ? { appleTeamId: process.env.T3_TV_TEAM_ID } : {}),
    infoPlist: {
      // Pairing targets are plain-HTTP LAN hosts (http://192.168.x.x:port).
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: "T3 Code connects to your coding server on this network.",
      // Only HTTPS/TLS from the OS, which is exempt from export compliance.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    [
      "@react-native-tvos/config-tv",
      {
        isTV: true,
        appleTVImages: {
          icon: "./assets/tvos/icon-1280x768.png",
          iconSmall: "./assets/tvos/icon-400x240.png",
          iconSmall2x: "./assets/tvos/icon-800x480.png",
          topShelf: "./assets/tvos/topshelf-1920x720.png",
          topShelf2x: "./assets/tvos/topshelf-3840x1440.png",
          topShelfWide: "./assets/tvos/topshelf-wide-2320x720.png",
          topShelfWide2x: "./assets/tvos/topshelf-wide-4640x1440.png",
        },
      },
    ],
  ],
});
