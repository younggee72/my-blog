(function () {
  "use strict";

  var SIZE = 4;
  var BEST_KEY = "2048-best-score";
  var THEME_KEY = "2048-theme";
  var SWIPE_THRESHOLD = 25;

  // ===== 상태 =====
  var board = [];
  var score = 0;
  var best = 0;
  var isGameOver = false;
  var hasWon = false;
  var winOverlayDismissed = false; // "계속하기"를 눌러 승리 오버레이를 닫았는지

  // ===== DOM 참조 =====
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var gridCellsEl = document.getElementById("grid-cells");
  var tileLayerEl = document.getElementById("tile-layer");
  var overlayEl = document.getElementById("overlay");
  var overlayMessageEl = document.getElementById("overlay-message");
  var overlayContinueBtn = document.getElementById("overlay-continue-btn");
  var overlayRestartBtn = document.getElementById("overlay-restart-btn");
  var newGameBtn = document.getElementById("new-game-btn");
  var themeToggleBtn = document.getElementById("theme-toggle-btn");
  var boardEl = document.getElementById("board");

  // ===== 초기화: 배경 셀 4x4 생성 =====
  function buildGridCells() {
    gridCellsEl.innerHTML = "";
    for (var i = 0; i < SIZE * SIZE; i++) {
      var cell = document.createElement("div");
      cell.className = "grid-cell";
      gridCellsEl.appendChild(cell);
    }
  }

  // ===== 보드 생성/조작 헬퍼 =====
  function createEmptyBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) {
        row.push(0);
      }
      b.push(row);
    }
    return b;
  }

  function cloneBoard(b) {
    return b.map(function (row) {
      return row.slice();
    });
  }

  function boardsEqual(a, b) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }

  function getEmptyCells(b) {
    var cells = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (b[r][c] === 0) cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  function addRandomTile(b) {
    var empties = getEmptyCells(b);
    if (empties.length === 0) return false;
    var pick = empties[Math.floor(Math.random() * empties.length)];
    var value = Math.random() < 0.9 ? 2 : 4;
    b[pick.row][pick.col] = value;
    return true;
  }

  // ===== 왼쪽으로 밀기: 한 줄 처리 =====
  // row: 길이 4 배열. 반환: { row: 처리된 배열, gained: 이번 줄에서 획득한 점수 }
  function slideAndMergeRow(row) {
    var compact = row.filter(function (v) {
      return v !== 0;
    });
    var gained = 0;
    for (var i = 0; i < compact.length - 1; i++) {
      if (compact[i] !== 0 && compact[i] === compact[i + 1]) {
        compact[i] = compact[i] * 2;
        gained += compact[i];
        compact[i + 1] = 0;
        i++; // 병합된 타일은 같은 턴에 다시 병합되지 않도록 건너뜀
      }
    }
    compact = compact.filter(function (v) {
      return v !== 0;
    });
    while (compact.length < SIZE) {
      compact.push(0);
    }
    return { row: compact, gained: gained };
  }

  // ===== 회전/전치 유틸 =====
  function transpose(b) {
    var result = createEmptyBoard();
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        result[c][r] = b[r][c];
      }
    }
    return result;
  }

  function reverseRows(b) {
    return b.map(function (row) {
      return row.slice().reverse();
    });
  }

  // 방향: "left" | "right" | "up" | "down"
  function move(direction) {
    var working = cloneBoard(board);
    var totalGained = 0;

    if (direction === "up") working = transpose(working);
    else if (direction === "down") working = reverseRows(transpose(working));
    else if (direction === "right") working = reverseRows(working);
    // left: 그대로

    for (var r = 0; r < SIZE; r++) {
      var result = slideAndMergeRow(working[r]);
      working[r] = result.row;
      totalGained += result.gained;
    }

    if (direction === "up") working = transpose(working);
    else if (direction === "down") working = transpose(reverseRows(working));
    else if (direction === "right") working = reverseRows(working);

    var moved = !boardsEqual(board, working);

    return { board: working, moved: moved, gained: totalGained };
  }

  function canMove(b) {
    if (getEmptyCells(b).length > 0) return true;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = b[r][c];
        if (c < SIZE - 1 && b[r][c + 1] === v) return true;
        if (r < SIZE - 1 && b[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  function boardHasTile(b, target) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (b[r][c] >= target) return true;
      }
    }
    return false;
  }

  // ===== 점수/최고점 =====
  function updateScore(newScore) {
    score = newScore;
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      saveBest();
    }
  }

  function loadBest() {
    try {
      var stored = localStorage.getItem(BEST_KEY);
      var parsed = parseInt(stored, 10);
      return isNaN(parsed) ? 0 : parsed;
    } catch (e) {
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch (e) {
      /* localStorage 사용 불가 시 무시 */
    }
  }

  // ===== 렌더링 =====
  function tileFontClass(value) {
    var digits = String(value).length;
    if (digits >= 5) return "tile-digits-5plus";
    if (digits === 4) return "tile-digits-4";
    return "";
  }

  function tileColorClass(value) {
    var known = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
    if (known.indexOf(value) !== -1) return "tile-" + value;
    return "tile-super";
  }

  function render() {
    tileLayerEl.innerHTML = "";
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var value = board[r][c];
        if (value === 0) continue;
        var tile = document.createElement("div");
        tile.className = "tile " + tileColorClass(value) + " " + tileFontClass(value);
        tile.style.setProperty("--row", String(r + 1));
        tile.style.setProperty("--col", String(c + 1));
        tile.textContent = String(value);
        tileLayerEl.appendChild(tile);
      }
    }
  }

  // ===== 오버레이 =====
  function showOverlay(message, showContinue) {
    overlayMessageEl.textContent = message;
    overlayContinueBtn.hidden = !showContinue;
    overlayEl.hidden = false;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
  }

  // ===== 게임 흐름 =====
  function startNewGame() {
    board = createEmptyBoard();
    isGameOver = false;
    hasWon = false;
    winOverlayDismissed = false;
    hideOverlay();
    addRandomTile(board);
    addRandomTile(board);
    updateScore(0);
    render();
  }

  function handleMove(direction) {
    if (isGameOver) return;
    if (hasWon && !winOverlayDismissed) return; // 승리 오버레이가 떠 있는 동안은 입력 무시

    var result = move(direction);
    if (!result.moved) return; // 변화 없으면 무시(새 타일 생성 안 함)

    board = result.board;
    if (result.gained > 0) {
      updateScore(score + result.gained);
    }

    addRandomTile(board);
    render();

    if (!hasWon && boardHasTile(board, 2048)) {
      hasWon = true;
      showOverlay("You Win!", true);
      return;
    }

    if (!canMove(board)) {
      isGameOver = true;
      showOverlay("Game Over", false);
    }
  }

  // ===== 키보드 입력 =====
  var KEY_DIRECTIONS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right"
  };

  document.addEventListener("keydown", function (e) {
    var direction = KEY_DIRECTIONS[e.key];
    if (!direction) return;
    e.preventDefault();
    handleMove(direction);
  });

  // ===== 터치 스와이프 =====
  var touchStartX = 0;
  var touchStartY = 0;
  var touchActive = false;

  boardEl.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length !== 1) return;
      touchActive = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchmove",
    function (e) {
      if (!touchActive) return;
      e.preventDefault(); // 페이지 스크롤 방지
    },
    { passive: false }
  );

  boardEl.addEventListener("touchend", function (e) {
    if (!touchActive) return;
    touchActive = false;
    var touch = e.changedTouches[0];
    var dx = touch.clientX - touchStartX;
    var dy = touch.clientY - touchStartY;

    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      handleMove(dx > 0 ? "right" : "left");
    } else {
      handleMove(dy > 0 ? "down" : "up");
    }
  });

  // ===== 버튼 =====
  newGameBtn.addEventListener("click", startNewGame);
  overlayRestartBtn.addEventListener("click", startNewGame);
  overlayContinueBtn.addEventListener("click", function () {
    winOverlayDismissed = true;
    hideOverlay();
  });

  // ===== 다크모드 토글 =====
  function applyTheme(theme) {
    if (theme === "dark" || theme === "light") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    themeToggleBtn.textContent = getEffectiveDarkMode() ? "☀️" : "🌙";
  }

  function getEffectiveDarkMode() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function loadTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* localStorage 사용 불가 시 무시 */
    }
  }

  themeToggleBtn.addEventListener("click", function () {
    var next = getEffectiveDarkMode() ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
  });

  // ===== 초기 실행 =====
  function init() {
    buildGridCells();
    best = loadBest();
    bestEl.textContent = String(best);

    var storedTheme = loadTheme();
    applyTheme(storedTheme);

    startNewGame();
  }

  init();
})();
