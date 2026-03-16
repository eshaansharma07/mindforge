const THEME_KEY = "mindforge_theme";

function getStoredTheme() {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" ? "light" : "dark";
}

function updateAiLogos(theme) {
  document.querySelectorAll(".theme-ai-logo").forEach((logo) => {
    const darkLogo = logo.dataset.logoDark;
    const lightLogo = logo.dataset.logoLight;
    if (!darkLogo || !lightLogo) return;
    logo.src = theme === "light" ? lightLogo : darkLogo;
  });
}

function updateThemeButtons(theme) {
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const nextTheme = theme === "light" ? "dark" : "light";
    button.textContent = nextTheme === "light" ? "Light Mode" : "Dark Mode";
    button.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
    button.dataset.nextTheme = nextTheme;
  });
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);
  updateAiLogos(nextTheme);
  updateThemeButtons(nextTheme);
}

function initTheme() {
  applyTheme(getStoredTheme());

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      applyTheme(currentTheme === "light" ? "dark" : "light");
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTheme);
} else {
  initTheme();
}
