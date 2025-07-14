/** @type {import('tailwindcss').Config} */
export default {
  // This 'content' array tells Tailwind to scan all .jsx and .html files
  // in the 'src' directory and the root for class names.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
