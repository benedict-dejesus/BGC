// Runs before the page paints so a saved theme never flashes. Light is the default.
(function applySavedTheme() {
  let theme = 'light';
  try {
    if (localStorage.getItem('bgc-theme') === 'dark') theme = 'dark';
  } catch {
    // Storage can be blocked. The page still works in light mode.
  }
  document.documentElement.dataset.theme = theme;
}());
