(function () {
  var RELEASES_REPO = "centific-cn/OneformaClient-releases";
  var ALLOWED_PREFIX = "https://github.com/" + RELEASES_REPO + "/releases/download/";
  var ENVS = ["prod", "qa", "preuat", "uat"];
  var STORAGE_KEY = "oneforma-download-env";

  function normalizeEnv(value) {
    var env = (value || "").toLowerCase();
    return ENVS.indexOf(env) === -1 ? "prod" : env;
  }

  function getEnv() {
    var match = /[?&]env=([^&]+)/.exec(window.location.search);
    if (match) {
      var fromUrl = normalizeEnv(decodeURIComponent(match[1]));
      try {
        localStorage.setItem(STORAGE_KEY, fromUrl);
      } catch (e) {}
      return fromUrl;
    }
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return normalizeEnv(stored);
      }
    } catch (e) {}
    return "prod";
  }

  function setEnv(env) {
    env = normalizeEnv(env);
    try {
      localStorage.setItem(STORAGE_KEY, env);
    } catch (e) {}
    updateEnvSelectorUI(env);
    wireVisibleCards(env);
  }

  // Tag contract (see docs/decisions/github-releases-sole-feed.md on the source
  // repo): latest-* tags are the electron-updater feed and stay signed-only.
  // Unsigned Windows QA builds live on the non-feed tag qa-win-manual; they are
  // manual downloads and are never polled by the client.
  function releaseTag(platform, env) {
    if (platform === "windows" && env === "qa") {
      return "qa-win-manual";
    }
    return "latest-" + env;
  }

  // Windows builds for these envs are distributed on the private source repo
  // only, so the public site has nothing to serve — say so instead of linking
  // a tag that will 404 for visitors.
  var WIN_PRIVATE_ENVS = ["preuat", "uat"];

  function versionFromAssetName(name) {
    var match = /OneForma-modern-(.+)\.(dmg|exe)/i.exec(name || "");
    return match ? match[1] : "";
  }

  function fetchRelease(platform, env) {
    var tag = releaseTag(platform, env);
    return fetch(
      "https://api.github.com/repos/" + RELEASES_REPO + "/releases/tags/" + tag,
      { headers: { Accept: "application/vnd.github+json" } }
    ).then(function (res) {
      return res.ok ? res.json() : null;
    });
  }

  function pickAsset(assets, ext) {
    if (!assets) {
      return null;
    }
    return assets.find(function (asset) {
      return (
        asset.name &&
        asset.name.toLowerCase().endsWith(ext) &&
        asset.browser_download_url &&
        asset.browser_download_url.indexOf(ALLOWED_PREFIX) === 0
      );
    });
  }

  function wireCard(platform, env) {
    var card = document.querySelector('.system-download-card[data-platform="' + platform + '"]');
    if (!card) {
      return;
    }
    var button = card.querySelector("[data-download-button]");
    var versionEl = card.querySelector("[data-version-line]");
    var envEl = card.querySelector("[data-env-banner]");
    var tag = releaseTag(platform, env);
    var fallback = "https://github.com/" + RELEASES_REPO + "/releases/tag/" + tag;

    if (platform === "windows" && WIN_PRIVATE_ENVS.indexOf(env) !== -1) {
      if (versionEl) {
        versionEl.textContent = "Not published for Windows on this channel · " + platformLabel;
      }
      if (button) {
        button.removeAttribute("href");
        button.setAttribute("aria-disabled", "true");
      }
      if (envEl) {
        envEl.textContent = env.toUpperCase() + " Windows builds are internal — ask the release owner";
        envEl.classList.add("is-visible");
      }
      return;
    }

    if (envEl) {
      if (env !== "prod") {
        envEl.textContent = env.toUpperCase() + " build — for internal testing only";
        envEl.classList.add("is-visible");
      } else {
        envEl.textContent = "";
        envEl.classList.remove("is-visible");
      }
    }

    var platformLabel = platform === "mac" ? "macOS 12+ · Universal" : "Windows 10/11 · 64-bit";
    if (versionEl) {
      versionEl.textContent = "Loading… · " + platformLabel;
    }
    if (button) {
      button.href = fallback;
      button.removeAttribute("aria-disabled");
    }

    fetchRelease(platform, env)
      .then(function (data) {
        if (!data) {
          return;
        }
        var ext = platform === "mac" ? ".dmg" : ".exe";
        var asset = pickAsset(data.assets, ext);
        if (!asset) {
          // Tag exists but carries nothing for this platform (e.g. prod
          // Windows before the signing gate opens): no dead button.
          if (versionEl) {
            versionEl.textContent = "Not available yet · " + platformLabel;
          }
          if (button) {
            button.removeAttribute("href");
            button.setAttribute("aria-disabled", "true");
          }
          return;
        }
        var version = versionFromAssetName(asset.name);
        if (versionEl) {
          versionEl.textContent = (version ? version + " · " : "") + platformLabel;
        }
        if (button) {
          button.href = asset.browser_download_url;
        }
      })
      .catch(function () {
        if (button) {
          button.href = fallback;
        }
      });
  }

  function wireVisibleCards(env) {
    ["mac", "windows"].forEach(function (platform) {
      if (document.querySelector('.system-download-card[data-platform="' + platform + '"]')) {
        wireCard(platform, env);
      }
    });
  }

  function updateEnvSelectorUI(env) {
    document.querySelectorAll("[data-env-option]").forEach(function (btn) {
      var active = btn.getAttribute("data-env-option") === env;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function initEnvSelector() {
    var root = document.querySelector("[data-env-selector]");
    if (!root) {
      return getEnv();
    }
    var env = getEnv();
    root.querySelectorAll("[data-env-option]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = btn.getAttribute("data-env-option");
        if (next) {
          setEnv(next);
        }
      });
    });
    updateEnvSelectorUI(env);
    return env;
  }

  function activateSetupGuide(platform) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-setup-tab]"));
    var panels = Array.prototype.slice.call(
      document.querySelectorAll("[data-setup-guide-panel]")
    );
    tabs.forEach(function (tab) {
      var active = tab.getAttribute("data-setup-tab") === platform;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(function (panel) {
      var active = panel.getAttribute("data-setup-guide-panel") === platform;
      panel.classList.toggle("is-active", active);
    });
  }

  function initSetupGuideTabs(defaultPlatform) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-setup-tab]"));
    if (!tabs.length) {
      return;
    }
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.getAttribute("data-setup-tab");
        if (target) {
          activateSetupGuide(target);
        }
      });
    });
    activateSetupGuide(defaultPlatform || "mac");
  }

  function wireBackHome() {
    var link = document.querySelector(".back-home");
    if (link) {
      link.href = "index.html";
    }
  }

  function initPage(options) {
    options = options || {};
    var env = initEnvSelector();
    wireVisibleCards(env);
    if (options.setupTab) {
      initSetupGuideTabs(options.setupTab);
    }
    wireBackHome();
  }

  window.OneformaDownload = {
    getEnv: getEnv,
    setEnv: setEnv,
    wireCard: wireCard,
    wireBackHome: wireBackHome,
    initEnvSelector: initEnvSelector,
    initSetupGuideTabs: initSetupGuideTabs,
    activateSetupGuide: activateSetupGuide,
    initPage: initPage,
  };
})();
