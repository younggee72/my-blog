(function () {
  "use strict";

  // ---- 상수 ----
  var GRID_SIZE = 16;
  var EXPORT_SCALE = 20;
  var THEME_STORAGE_KEY = "pixel-art-theme";

  var DEFAULT_PALETTE = [
    "#000000", "#7f7f7f", "#c3c3c3", "#ffffff",
    "#ff0000", "#ff7f27", "#ffff00", "#22b14c",
    "#00a2e8", "#3f48cc", "#a349a4", "#ff00ff",
    "#ffaec9", "#b97a57", "#873600", "#00ff00"
  ];

  // ---- 상태 ----
  var pixels = createEmptyPixels();
  var currentTool = "pen"; // "pen" | "eraser"
  var currentColor = "#ff0000";
  var isDrawing = false;

  // ---- DOM 참조 ----
  var gridEl = document.getElementById("pixelGrid");
  var paletteEl = document.getElementById("palette");
  var customColorPicker = document.getElementById("customColorPicker");
  var currentColorIndicator = document.getElementById("currentColorIndicator");
  var penToolBtn = document.getElementById("penTool");
  var eraserToolBtn = document.getElementById("eraserTool");
  var clearBtn = document.getElementById("clearBtn");
  var saveBtn = document.getElementById("saveBtn");
  var themeToggle = document.getElementById("themeToggle");
  var themeToggleIcon = document.getElementById("themeToggleIcon");

  // ---- 좌표 헬퍼 ----
  function createEmptyPixels() {
    var arr = new Array(GRID_SIZE * GRID_SIZE);
    for (var i = 0; i < arr.length; i++) {
      arr[i] = null;
    }
    return arr;
  }

  function indexToRowCol(i) {
    return { row: Math.floor(i / GRID_SIZE), col: i % GRID_SIZE };
  }

  function rowColToIndex(r, c) {
    return r * GRID_SIZE + c;
  }

  // ---- 격자 생성 ----
  function buildGrid() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      var cell = document.createElement("div");
      cell.className = "cell empty";
      cell.dataset.index = String(i);
      fragment.appendChild(cell);
    }
    gridEl.appendChild(fragment);
  }

  function renderCell(index) {
    var cell = gridEl.children[index];
    if (!cell) return;
    var value = pixels[index];
    if (value === null) {
      cell.classList.add("empty");
      cell.style.backgroundColor = "";
    } else {
      cell.classList.remove("empty");
      cell.style.backgroundColor = value;
    }
  }

  function renderAll() {
    for (var i = 0; i < pixels.length; i++) {
      renderCell(i);
    }
  }

  // ---- 그리기/지우기 ----
  function applyToolAt(index) {
    if (index < 0 || index >= pixels.length) return;
    if (currentTool === "pen") {
      pixels[index] = currentColor;
    } else {
      pixels[index] = null;
    }
    renderCell(index);
  }

  function getIndexFromEventTarget(target) {
    if (target && target.classList && target.classList.contains("cell")) {
      return parseInt(target.dataset.index, 10);
    }
    return -1;
  }

  // ---- 마우스 입력 ----
  gridEl.addEventListener("mousedown", function (e) {
    var index = getIndexFromEventTarget(e.target);
    if (index === -1) return;
    isDrawing = true;
    applyToolAt(index);
  });

  gridEl.addEventListener("mousemove", function (e) {
    if (!isDrawing) return;
    var index = getIndexFromEventTarget(e.target);
    if (index === -1) return;
    applyToolAt(index);
  });

  document.addEventListener("mouseup", function () {
    isDrawing = false;
  });

  gridEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  // ---- 터치 입력 ----
  gridEl.addEventListener("touchstart", function (e) {
    e.preventDefault();
    isDrawing = true;
    var touch = e.touches[0];
    if (!touch) return;
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    var index = getIndexFromEventTarget(target);
    if (index !== -1) applyToolAt(index);
  }, { passive: false });

  gridEl.addEventListener("touchmove", function (e) {
    e.preventDefault();
    if (!isDrawing) return;
    var touch = e.touches[0];
    if (!touch) return;
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    var index = getIndexFromEventTarget(target);
    if (index !== -1) applyToolAt(index);
  }, { passive: false });

  gridEl.addEventListener("touchend", function () {
    isDrawing = false;
  });

  gridEl.addEventListener("touchcancel", function () {
    isDrawing = false;
  });

  // ---- 팔레트 ----
  function buildPalette() {
    var fragment = document.createDocumentFragment();
    DEFAULT_PALETTE.forEach(function (color) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch";
      btn.style.backgroundColor = color;
      btn.dataset.color = color;
      btn.title = color;
      btn.addEventListener("click", function () {
        selectColor(color);
        selectTool("pen");
      });
      fragment.appendChild(btn);
    });
    paletteEl.appendChild(fragment);
  }

  function selectColor(color) {
    currentColor = color;
    updateCurrentColorIndicator();
    updateSelectedSwatch();
  }

  function updateSelectedSwatch() {
    var swatches = paletteEl.querySelectorAll(".swatch");
    swatches.forEach(function (s) {
      if (s.dataset.color.toLowerCase() === currentColor.toLowerCase()) {
        s.classList.add("selected");
      } else {
        s.classList.remove("selected");
      }
    });
  }

  function updateCurrentColorIndicator() {
    if (currentTool === "eraser") {
      currentColorIndicator.classList.add("eraser-mode");
      currentColorIndicator.style.backgroundColor = "";
      currentColorIndicator.title = "지우개";
    } else {
      currentColorIndicator.classList.remove("eraser-mode");
      currentColorIndicator.style.backgroundColor = currentColor;
      currentColorIndicator.title = currentColor;
    }
  }

  customColorPicker.addEventListener("input", function (e) {
    selectColor(e.target.value);
    selectTool("pen");
  });

  // ---- 도구 ----
  function selectTool(tool) {
    currentTool = tool;
    penToolBtn.classList.toggle("selected", tool === "pen");
    penToolBtn.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
    eraserToolBtn.classList.toggle("selected", tool === "eraser");
    eraserToolBtn.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
    updateCurrentColorIndicator();
  }

  penToolBtn.addEventListener("click", function () {
    selectTool("pen");
  });

  eraserToolBtn.addEventListener("click", function () {
    selectTool("eraser");
  });

  // ---- Clear ----
  clearBtn.addEventListener("click", function () {
    var confirmed = window.confirm("정말 전체를 지우시겠습니까?");
    if (!confirmed) return;
    pixels = createEmptyPixels();
    renderAll();
  });

  // ---- PNG 저장 ----
  function exportToPng() {
    var canvas = document.createElement("canvas");
    canvas.width = GRID_SIZE * EXPORT_SCALE;
    canvas.height = GRID_SIZE * EXPORT_SCALE;
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    for (var i = 0; i < pixels.length; i++) {
      var value = pixels[i];
      if (value === null) continue;
      var rc = indexToRowCol(i);
      ctx.fillStyle = value;
      ctx.fillRect(rc.col * EXPORT_SCALE, rc.row * EXPORT_SCALE, EXPORT_SCALE, EXPORT_SCALE);
    }

    var dataUrl = canvas.toDataURL("image/png");
    var link = document.createElement("a");
    link.href = dataUrl;
    link.download = "pixel-art.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  saveBtn.addEventListener("click", exportToPng);

  // ---- 다크모드 ----
  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggle.setAttribute("aria-pressed", "true");
      themeToggleIcon.textContent = "☀️";
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      themeToggle.setAttribute("aria-pressed", "false");
      themeToggleIcon.textContent = "🌙";
    }
  }

  function initTheme() {
    var stored = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (e) {
      stored = null;
    }
    if (stored === "dark" || stored === "light") {
      applyTheme(stored);
    } else {
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyTheme(prefersDark ? "dark" : "light");
    }
  }

  themeToggle.addEventListener("click", function () {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark";
    var next = isDark ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (e) {
      /* localStorage 사용 불가 시 무시 */
    }
  });

  // ---- 초기화 ----
  function init() {
    buildGrid();
    renderAll();
    buildPalette();
    selectColor(currentColor);
    selectTool("pen");
    initTheme();
  }

  init();
})();
