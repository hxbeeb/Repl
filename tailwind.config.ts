import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#121417",
        paper: "#f7f5ef",
        line: "#ded8cb"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(18, 20, 23, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
