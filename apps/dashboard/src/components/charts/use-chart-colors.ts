"use client";

import { useState, useEffect } from "react";

export type ChartColors = {
  foreground: string;
  mutedForeground: string;
  dimForeground: string;
  border: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;
};

const DARK_DEFAULTS: ChartColors = {
  foreground: "#e5e5e5",
  mutedForeground: "#a1a1aa",
  dimForeground: "#71717a",
  border: "rgba(255,255,255,0.08)",
  tooltipBg: "rgba(0,0,0,0.88)",
  tooltipBorder: "rgba(255,255,255,0.1)",
  tooltipText: "#e5e5e5",
  tooltipMuted: "#a1a1aa",
};

const LIGHT_DEFAULTS: ChartColors = {
  foreground: "#18181b",
  mutedForeground: "#71717a",
  dimForeground: "#a1a1aa",
  border: "rgba(0,0,0,0.08)",
  tooltipBg: "rgba(255,255,255,0.95)",
  tooltipBorder: "rgba(0,0,0,0.1)",
  tooltipText: "#18181b",
  tooltipMuted: "#71717a",
};

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(DARK_DEFAULTS);

  useEffect(() => {
    function update() {
      const isDark = document.documentElement.classList.contains("dark");
      setColors(isDark ? DARK_DEFAULTS : LIGHT_DEFAULTS);
    }
    update();

    // Watch for dark mode toggle
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}
