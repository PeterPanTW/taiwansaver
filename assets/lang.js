/* TaiwanSaver — lightweight EN/中 language toggle.
   Translatable text uses elements with data-en and data-zh attributes.
   Choice persists in localStorage; default is English. */
(function () {
  var KEY = "ts-lang";
  function get() {
    try { return localStorage.getItem(KEY) || "en"; } catch (e) { return "en"; }
  }
  function apply(lang) {
    document.documentElement.lang = (lang === "zh") ? "zh-Hant" : "en";
    var nodes = document.querySelectorAll("[data-en]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var val = el.getAttribute("data-" + lang);
      if (val === null) val = el.getAttribute("data-en");
      // Allow inline HTML (e.g. <b>, <br>, <em>) in translations.
      if (val.indexOf("<") !== -1) el.innerHTML = val;
      else el.textContent = val;
    }
    var btns = document.querySelectorAll("[data-lang-toggle]");
    for (var j = 0; j < btns.length; j++) {
      btns[j].textContent = (lang === "zh") ? "EN" : "中";
      btns[j].setAttribute("aria-label", (lang === "zh") ? "Switch to English" : "切換成中文");
    }
  }
  function set(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    apply(lang);
  }
  window.TSLang = { toggle: function () { set(get() === "zh" ? "en" : "zh"); }, set: set, get: get };
  document.addEventListener("DOMContentLoaded", function () {
    apply(get());
    var btns = document.querySelectorAll("[data-lang-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function (e) { e.preventDefault(); window.TSLang.toggle(); });
    }
  });
})();
