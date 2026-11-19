/**
 * 圖片批次轉 JPG（純前端）
 * TARGET_WIDTH / MAX_BYTES 可調
 * 下載為個別 JPG；一鍵下載全部 = 連續下載多檔（不打包 ZIP）
 */
(function () {
  "use strict";

  const TARGET_WIDTH = 1000;
  const MAX_BYTES = 500 * 1024;
  const MIN_QUALITY = 0.35;
  const MAX_QUALITY = 0.92;
  const MIN_WIDTH = 320;

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const toolbar = document.getElementById("toolbar");
  const btnClear = document.getElementById("btnClear");
  const btnDownloadAll = document.getElementById("btnDownloadAll");
  const barHint = document.getElementById("barHint");
  const heroStats = document.getElementById("heroStats");
  const statTotal = document.getElementById("statTotal");
  const statDone = document.getElementById("statDone");

  /** @type {Array<any>} */
  let items = [];
  let processing = false;
  let dragDepth = 0;
  let downloadingAll = false;

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length) {
      addFiles(fileInput.files);
      fileInput.value = "";
    }
  });

  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    dropzone.classList.add("is-drag");
  });
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove("is-drag");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove("is-drag");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) addFiles(files);
  });

  btnClear.addEventListener("click", () => {
    for (const it of items) revokeUrls(it);
    items = [];
    render();
    dropzone.focus();
  });

  btnDownloadAll.addEventListener("click", async () => {
    const ready = items.filter((i) => i.status === "done" && i.blob);
    if (!ready.length || downloadingAll) return;
    downloadingAll = true;
    btnDownloadAll.disabled = true;
    const label = btnDownloadAll.querySelector(".btn-label");
    try {
      for (let i = 0; i < ready.length; i++) {
        if (label) label.textContent = "下載中 " + (i + 1) + "/" + ready.length;
        downloadBlob(ready[i].blob, ready[i].outName || "image.jpg");
        await sleep(380);
      }
    } finally {
      downloadingAll = false;
      if (label) label.textContent = "下載全部 JPG";
      updateChrome();
    }
  });

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function revokeUrls(it) {
    if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    it.thumbUrl = it.previewUrl = undefined;
  }

  function addFiles(fileList) {
    const arr = Array.from(fileList).filter(isLikelyImage);
    if (!arr.length) {
      alert("請拖入圖片檔（JPG / PNG / WebP / GIF / BMP 等）");
      return;
    }
    for (const file of arr) {
      items.push({
        id: "f-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
        name: file.name,
        status: "queued",
        origBytes: file.size,
        _file: file,
        thumbUrl: URL.createObjectURL(file),
      });
    }
    render();
    processQueue();
  }

  function isLikelyImage(file) {
    if (file.type && file.type.startsWith("image/")) return true;
    return /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name);
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      while (true) {
        const next = items.find((i) => i.status === "queued");
        if (!next) break;
        next.status = "working";
        render();
        try {
          const result = await convertImage(next._file);
          next.blob = result.blob;
          next.outBytes = result.blob.size;
          next.outName = result.outName;
          next.meta = result.meta;
          if (next.previewUrl) URL.revokeObjectURL(next.previewUrl);
          next.previewUrl = URL.createObjectURL(result.blob);
          next.status = "done";
        } catch (err) {
          console.error(err);
          next.status = "error";
          next.err = err && err.message ? err.message : String(err);
        }
        render();
      }
    } finally {
      processing = false;
      updateChrome();
    }
  }

  async function convertImage(file) {
    const bitmap = await loadBitmap(file);
    try {
      let width = bitmap.width;
      let height = bitmap.height;
      if (width > TARGET_WIDTH) {
        const scale = TARGET_WIDTH / width;
        width = TARGET_WIDTH;
        height = Math.max(1, Math.round(height * scale));
      }
      let w = width;
      let h = height;
      let blob = await compressToLimit(bitmap, w, h);
      while (blob.size > MAX_BYTES && w > MIN_WIDTH) {
        w = Math.max(MIN_WIDTH, Math.floor(w * 0.9));
        h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
        blob = await compressToLimit(bitmap, w, h);
      }
      if (blob.size > MAX_BYTES) {
        const finalW = Math.min(w, MIN_WIDTH);
        const finalH = Math.max(1, Math.round((bitmap.height * finalW) / bitmap.width));
        blob = await encodeJpeg(bitmap, finalW, finalH, MIN_QUALITY);
        w = finalW;
        h = finalH;
      }
      return { blob, outName: toJpgName(file.name), meta: { width: w, height: h } };
    } finally {
      if (bitmap && typeof bitmap.close === "function") bitmap.close();
    }
  }

  async function compressToLimit(bitmap, width, height) {
    let lo = MIN_QUALITY;
    let hi = MAX_QUALITY;
    let best = await encodeJpeg(bitmap, width, height, lo);
    if (best.size > MAX_BYTES) return best;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const b = await encodeJpeg(bitmap, width, height, mid);
      if (b.size <= MAX_BYTES) {
        best = b;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return best;
  }

  function encodeJpeg(bitmap, width, height, quality) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) {
        reject(new Error("無法建立 Canvas"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("轉檔失敗"))),
        "image/jpeg",
        quality
      );
    });
  }

  async function loadBitmap(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file);
      } catch (_) {}
    }
    const url = URL.createObjectURL(file);
    try {
      return await loadHtmlImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("無法讀取圖片（可能損壞或不支援的格式）"));
      img.src = url;
    });
  }

  function toJpgName(name) {
    return (name.replace(/\.[^.]+$/, "") || "image") + ".jpg";
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function badgeText(status) {
    if (status === "queued") return "等待";
    if (status === "working") return "轉換中";
    if (status === "done") return "完成";
    if (status === "error") return "失敗";
    return status;
  }

  function render() {
    listEl.innerHTML = "";
    const has = items.length > 0;
    emptyEl.hidden = has;
    toolbar.hidden = !has;

    for (const it of items) {
      const li = document.createElement("li");
      li.className = "card status-" + it.status;

      const thumb = document.createElement("div");
      thumb.className = "thumb";
      const src = it.previewUrl || it.thumbUrl;
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = it.name;
        img.loading = "lazy";
        thumb.appendChild(img);
      }
      const badge = document.createElement("span");
      badge.className = "thumb-badge " + it.status;
      if (it.status === "done") badge.classList.add("ok");
      badge.textContent = badgeText(it.status);
      thumb.appendChild(badge);

      const body = document.createElement("div");
      body.className = "card-body";

      const name = document.createElement("p");
      name.className = "card-name";
      name.title = it.name;
      name.textContent = it.name;

      const meta = document.createElement("p");
      meta.className = "card-meta";
      if (it.status === "queued") {
        meta.textContent = "原始 " + formatBytes(it.origBytes);
      } else if (it.status === "working") {
        meta.textContent = "正在壓縮與轉檔…";
      } else if (it.status === "done") {
        meta.classList.add("ok");
        const m = it.meta || {};
        const ok = it.outBytes <= MAX_BYTES;
        meta.textContent =
          (m.width || "?") +
          " × " +
          (m.height || "?") +
          " · " +
          formatBytes(it.outBytes) +
          (ok ? "" : " · 仍偏大") +
          " · 原 " +
          formatBytes(it.origBytes);
      } else {
        meta.classList.add("error");
        meta.textContent = it.err || "轉檔失敗";
      }

      const actions = document.createElement("div");
      actions.className = "card-actions";
      if (it.status === "done" && it.blob) {
        const dl = document.createElement("button");
        dl.type = "button";
        dl.className = "btn btn-card primary";
        dl.textContent = "下載";
        dl.addEventListener("click", (e) => {
          e.stopPropagation();
          downloadBlob(it.blob, it.outName || "image.jpg");
        });
        actions.appendChild(dl);
      }
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-card";
      rm.textContent = "移除";
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        revokeUrls(it);
        items = items.filter((x) => x.id !== it.id);
        render();
      });
      actions.appendChild(rm);

      body.appendChild(name);
      body.appendChild(meta);
      body.appendChild(actions);
      li.appendChild(thumb);
      li.appendChild(body);
      listEl.appendChild(li);
    }
    updateChrome();
  }

  function updateChrome() {
    const done = items.filter((i) => i.status === "done" && i.blob).length;
    const busy = items.some((i) => i.status === "queued" || i.status === "working");
    const has = items.length > 0;
    heroStats.hidden = !has;
    statTotal.textContent = String(items.length);
    statDone.textContent = String(done);
    btnClear.disabled = !has;
    btnDownloadAll.disabled = downloadingAll || done === 0 || busy;
    barHint.textContent = has
      ? busy
        ? "轉換中，完成後即可下載"
        : done
          ? "可單張下載，或一次下載全部 JPG"
          : "尚無可下載的檔案"
      : "";
  }

  render();
})();
