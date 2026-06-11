/* PostCSS config — required for NativeWind v5 / Tailwind CSS v4.
 *
 * Expo's CSS pipeline only runs Tailwind when @tailwindcss/postcss is wired
 * here; without it the raw @theme/@utility at-rules in global.css reach
 * react-native-css's lightningcss compiler and fail the native bundle.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
