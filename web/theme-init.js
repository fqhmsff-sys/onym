// Dijalankan sebelum render pertama agar tema langsung benar (tanpa kilatan terang).
(function () {
  try {
    var t = localStorage.getItem("hh_theme");
    if (!t) t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === "dark" ? "#0E0F12" : "#FFFFFF";
  } catch (e) { /* abaikan */ }
  try { if (localStorage.getItem("hh_motion") === "0") document.documentElement.dataset.motion = "off"; } catch (e) { /* abaikan */ }
})();
