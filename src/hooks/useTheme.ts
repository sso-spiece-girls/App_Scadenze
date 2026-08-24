import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../types";

const SETTINGS_KEY = "app_scadenza:settings";

const DEFAULTS: AppSettings = { theme: "system" };

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as AppSettings) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** useTheme — dark/light/system theme management with localStorage persistence. */
export function useTheme() {
  const [settings, setSettings] = useState<AppSettings>(readSettings);

  useEffect(() => {
    const root = document.documentElement;
    const dark = settings.theme === "dark" || (settings.theme === "system" && systemPrefersDark());
    root.classList.toggle("dark", dark);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const setTheme = useCallback((theme: AppSettings["theme"]) => {
    setSettings((prev) => ({ ...prev, theme }));
  }, []);

  return { theme: settings.theme, setTheme, isDark: settings.theme === "dark" || (settings.theme === "system" && systemPrefersDark()) };
}