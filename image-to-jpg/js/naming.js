/**
 * 圖片轉 JPG：編號與檔名規則（純函式，可供測試）
 * 編號會去掉空白並轉成大寫；有編號時依目前順序命名為 {編號}A01.jpg。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ImageToJpgNaming = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeStyleCode(raw) {
    return String(raw == null ? "" : raw).replace(/\s+/g, "").toUpperCase();
  }

  function sequenceSuffix(index) {
    const n = Number(index) + 1;
    if (!Number.isFinite(n) || n < 1) return "A01";
    return "A" + (n < 100 ? String(n).padStart(2, "0") : String(n));
  }

  function displayName(styleCode, index, fallbackBase) {
    const code = normalizeStyleCode(styleCode);
    if (code) return code + sequenceSuffix(index);
    return fallbackBase || "";
  }

  function fileName(styleCode, index, originalOutName) {
    const code = normalizeStyleCode(styleCode);
    if (code) return code + sequenceSuffix(index) + ".jpg";
    return originalOutName || "image.jpg";
  }

  return {
    normalizeStyleCode: normalizeStyleCode,
    sequenceSuffix: sequenceSuffix,
    displayName: displayName,
    fileName: fileName,
  };
});
