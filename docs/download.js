(function () {
  var RELEASES_REPO = "centific-cn/OneformaClient-releases";
  var ALLOWED_PREFIX = "https://github.com/" + RELEASES_REPO + "/releases/download/";
  // This site serves the production release only. Other environments are GitHub Releases, not pages here.
  var RELEASE_TAG = "latest-prod";

  function versionFromAssetName(name) {
    var match = /OneForma-modern-(.+)\.(dmg|exe)/i.exec(name || "");
    return match ? match[1] : "";
  }

  function fetchRelease() {
    var tag = RELEASE_TAG;
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

  // Primary data source is the same-origin static feed (docs/feed/latest-prod.json,
  // committed by the publish job) — api.github.com is anonymous 60 req/h per IP
  // and chronically rate-limited on shared/CN egress, which silently left the
  // buttons on their fallback tag-page href. The API below stays as fallback.
  function wireCard(platform, feedAsset) {
    var card = document.querySelector('.system-download-card[data-platform="' + platform + '"]');
    if (!card) {
      return;
    }
    var button = card.querySelector("[data-download-button]");
    var versionEl = card.querySelector("[data-version-line]");
    var fallback = "https://github.com/" + RELEASES_REPO + "/releases/tag/" + RELEASE_TAG;
    var platformLabel = platform === "mac" ? "macOS 12+ · Universal" : "Windows 10/11 · 64-bit";

    if (
      feedAsset &&
      feedAsset.url &&
      feedAsset.url.indexOf(ALLOWED_PREFIX) === 0
    ) {
      if (versionEl) {
        versionEl.textContent = (versionFromAssetName(feedAsset.url) || "") + " · " + platformLabel;
      }
      if (button) {
        button.href = feedAsset.url;
        button.removeAttribute("aria-disabled");
      }
      return;
    }

    if (versionEl) {
      versionEl.textContent = "Loading… · " + platformLabel;
    }
    if (button) {
      button.href = fallback;
      button.removeAttribute("aria-disabled");
    }

    fetchRelease()
      .then(function (data) {
        if (!data) {
          // API unreachable (rate limit / network): say so instead of leaving
          // the card on an eternal "Loading…" with a silent tag-page fallback.
          if (versionEl) {
            versionEl.textContent = "Can't check the version — use the button · " + platformLabel;
          }
          if (button) {
            button.textContent = "VIEW RELEASES PAGE";
          }
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
        if (versionEl) {
          versionEl.textContent = "Can't check the version — use the button · " + platformLabel;
        }
        if (button) {
          button.textContent = "VIEW RELEASES PAGE";
          button.href = fallback;
        }
      });
  }

  function wireVisibleCards() {
    fetch("feed/" + RELEASE_TAG + ".json")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (feed) {
        ["mac", "windows"].forEach(function (platform) {
          if (!document.querySelector('.system-download-card[data-platform="' + platform + '"]')) {
            return;
          }
          var feedAsset = feed && feed[platform === "mac" ? "mac" : "win"];
          wireCard(platform, feedAsset || null);
        });
      });
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

  function initPage(options) {
    options = options || {};
    wireVisibleCards();
    if (options.setupTab) {
      initSetupGuideTabs(options.setupTab);
    }
  }

  window.OneformaDownload = {
    wireCard: wireCard,
    initSetupGuideTabs: initSetupGuideTabs,
    activateSetupGuide: activateSetupGuide,
    initPage: initPage,
  };
})();
